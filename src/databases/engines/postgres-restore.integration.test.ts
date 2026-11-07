import { expect, test } from "bun:test";

import { runProcess } from "@/process";

import { postgresEngine } from "./postgres.engine";

const COMMAND_TIMEOUT_IN_MS = 180_000;
const STARTUP_TIMEOUT_IN_MS = 60_000;
const POLL_INTERVAL_IN_MS = 250;
const DUMP_PATH = "/tmp/backup.dump";

async function docker(command: readonly string[]): Promise<string> {
  const result = await runProcess(["docker", ...command], { timeoutInMs: COMMAND_TIMEOUT_IN_MS });
  if (result.exitCode !== 0) {
    throw new Error(`PostgreSQL restore fixture failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function startPostgres() {
  const name = `nelcota-restore-safety-${Bun.randomUUIDv7()}`;
  await docker([
    "run",
    "--rm",
    "--detach",
    "--name",
    name,
    "--env",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "--env",
    "POSTGRES_USER=app",
    "--env",
    "POSTGRES_DB=app",
    postgresEngine.imageTag,
  ]);
  return {
    name,
    sql: async (statement: string) =>
      await docker([
        "exec",
        name,
        "psql",
        "--no-psqlrc",
        "--username",
        "app",
        "--dbname",
        "app",
        "--set",
        "ON_ERROR_STOP=1",
        "--tuples-only",
        "--no-align",
        "--command",
        statement,
      ]),
    [Symbol.asyncDispose]: async () => {
      await docker(["rm", "--force", name]);
    },
  };
}

type Fixture = Awaited<ReturnType<typeof startPostgres>>;

async function waitUntilReady(name: string, deadline: number): Promise<void> {
  const result = await runProcess(["docker", "exec", name, ...postgresEngine.readinessCommand], {
    timeoutInMs: STARTUP_TIMEOUT_IN_MS,
  });
  if (postgresEngine.isReady(result)) {
    return;
  }
  if (Date.now() >= deadline) {
    throw new Error("PostgreSQL restore fixture did not start");
  }
  await Bun.sleep(POLL_INTERVAL_IN_MS);
  await waitUntilReady(name, deadline);
}

async function seedBackup(fixture: Fixture, extraBeforeDump = ""): Promise<void> {
  await waitUntilReady(fixture.name, Date.now() + STARTUP_TIMEOUT_IN_MS);
  await fixture.sql(
    "CREATE TABLE original (value text); INSERT INTO original VALUES ('before'); CREATE TABLE z_migrations (value text);",
  );
  if (extraBeforeDump !== "") {
    await fixture.sql(extraBeforeDump);
  }
  const commands = postgresEngine.backup;
  if (commands == null) {
    throw new Error("PostgreSQL must support backups");
  }
  await docker(["exec", fixture.name, ...commands.dump(DUMP_PATH)]);
  await fixture.sql(
    "UPDATE original SET value = 'after'; CREATE SCHEMA later; CREATE TABLE later.extra (value text);",
  );
}

function restorePlan() {
  const commands = postgresEngine.backup;
  if (commands == null) {
    throw new Error("PostgreSQL must support restores");
  }
  return commands.restore(DUMP_PATH);
}

async function executeRestore(
  name: string,
  restore: ReturnType<typeof restorePlan>,
): Promise<void> {
  await using _cleanup = {
    [Symbol.asyncDispose]: async () => {
      await Promise.all(
        restore.cleanup.map(async (command) => await docker(["exec", name, ...command])),
      );
    },
  };
  for (const command of restore.commands) {
    // The database must finish loading before the activation transaction runs.
    await docker(["exec", name, ...command]);
  }
}

async function waitForWriter(fixture: Fixture, deadline: number): Promise<void> {
  if ((await fixture.sql("SELECT count(*) > 0 FROM z_migrations")) === "t") {
    return;
  }
  if (Date.now() >= deadline) {
    throw new Error("PostgreSQL reconnecting writer did not start");
  }
  await Bun.sleep(POLL_INTERVAL_IN_MS);
  await waitForWriter(fixture, deadline);
}

test(
  "restores privately while an application keeps reconnecting and running migrations",
  async () => {
    await using fixture = await startPostgres();
    await seedBackup(
      fixture,
      "DO $$ BEGIN FOR i IN 1..500 LOOP EXECUTE format('CREATE TABLE a_%s (value text)', i); END LOOP; END $$;",
    );
    const writer = runProcess(
      [
        "docker",
        "exec",
        fixture.name,
        "sh",
        "-c",
        "while [ ! -f /tmp/stop-writer ]; do psql -U app -d app -c \"CREATE TABLE IF NOT EXISTS z_migrations(value text); INSERT INTO z_migrations VALUES ('live');\" >/dev/null 2>&1; sleep 0.01; done",
      ],
      { timeoutInMs: COMMAND_TIMEOUT_IN_MS },
    );
    await using _writer = {
      [Symbol.asyncDispose]: async () => {
        await docker(["exec", fixture.name, "touch", "/tmp/stop-writer"]);
        await writer;
      },
    };
    await waitForWriter(fixture, Date.now() + STARTUP_TIMEOUT_IN_MS);

    await executeRestore(fixture.name, restorePlan());

    expect(await fixture.sql("SELECT value FROM original")).toBe("before");
    expect(await fixture.sql("SELECT count(*) FROM pg_namespace WHERE nspname = 'later'")).toBe(
      "0",
    );
  },
  COMMAND_TIMEOUT_IN_MS,
);

test(
  "preserves the live database when loading the staged backup fails",
  async () => {
    await using fixture = await startPostgres();
    await seedBackup(
      fixture,
      "CREATE ROLE archived_reader; GRANT SELECT ON original TO archived_reader;",
    );
    await fixture.sql("REVOKE SELECT ON original FROM archived_reader; DROP ROLE archived_reader;");

    const failure = await executeRestore(fixture.name, restorePlan()).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain("archived_reader");
    expect(await fixture.sql("SELECT value FROM original")).toBe("after");
    expect(await fixture.sql("SELECT count(*) FROM pg_namespace WHERE nspname = 'later'")).toBe(
      "1",
    );
    expect(
      await fixture.sql(
        "SELECT count(*) FROM pg_database WHERE datname LIKE 'nelcota_restore_%' OR datname LIKE 'nelcota_retired_%'",
      ),
    ).toBe("0");
  },
  COMMAND_TIMEOUT_IN_MS,
);

test(
  "rolls both database names back if activation fails after the renames",
  async () => {
    await using fixture = await startPostgres();
    await seedBackup(fixture);
    const restore = restorePlan();
    const activate = restore.commands.at(-1);
    const statement = activate?.at(-1);
    if (activate == null || statement == null) {
      throw new Error("Expected an activation transaction");
    }
    const commands = restore.commands.with(
      restore.commands.length - 1,
      activate.with(activate.length - 1, `${statement}\nSELECT 1 / 0;`),
    );

    const failure = await executeRestore(fixture.name, { ...restore, commands }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain("division by zero");
    expect(await fixture.sql("SELECT value FROM original")).toBe("after");
    expect(await fixture.sql("SELECT count(*) FROM pg_namespace WHERE nspname = 'later'")).toBe(
      "1",
    );
    expect(
      await fixture.sql(
        "SELECT count(*) FROM pg_database WHERE datname LIKE 'nelcota_restore_%' OR datname LIKE 'nelcota_retired_%'",
      ),
    ).toBe("0");
  },
  COMMAND_TIMEOUT_IN_MS,
);
