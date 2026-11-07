import { expect, test } from "bun:test";

import { type ProcessResult, runProcess } from "@/process";

import { postgresEngine } from "./postgres.engine";

const COMMAND_TIMEOUT_IN_MS = 180_000;
const STARTUP_TIMEOUT_IN_MS = 60_000;
const POLL_INTERVAL_IN_MS = 250;

async function docker(command: readonly string[]): Promise<string> {
  const result = await runProcess(["docker", ...command], { timeoutInMs: COMMAND_TIMEOUT_IN_MS });
  if (result.exitCode !== 0) {
    throw new Error(`PostgreSQL fixture command failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function waitUntilReady(container: string, deadline: number): Promise<void> {
  const result = await runProcess(
    ["docker", "exec", container, ...postgresEngine.readinessCommand],
    { timeoutInMs: STARTUP_TIMEOUT_IN_MS },
  );
  if (postgresEngine.isReady(result)) {
    return;
  }
  if (Date.now() >= deadline) {
    throw new Error("PostgreSQL fixture did not become ready");
  }
  await Bun.sleep(POLL_INTERVAL_IN_MS);
  await waitUntilReady(container, deadline);
}

test(
  "restores the complete database while terminating existing connections",
  async () => {
    const name = `nelcota-pg-restore-${Bun.randomUUIDv7()}`;
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
    await using _container = {
      [Symbol.asyncDispose]: async () => {
        await docker(["rm", "--force", name]);
      },
    };
    await waitUntilReady(name, Date.now() + STARTUP_TIMEOUT_IN_MS);
    const sql = async (statement: string) =>
      await docker([
        "exec",
        name,
        "psql",
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
      ]);
    const commands = postgresEngine.backup;
    if (commands == null) {
      throw new Error("PostgreSQL must support backups");
    }
    await sql("CREATE TABLE original (value text); INSERT INTO original VALUES ('before');");
    await docker(["exec", name, ...commands.dump("/tmp/backup.dump")]);
    await sql(
      "UPDATE original SET value = 'after'; CREATE SCHEMA later; CREATE TABLE later.extra (value text); INSERT INTO later.extra VALUES ('after');",
    );
    const connected = runProcess(
      ["docker", "exec", name, "psql", "-U", "app", "-d", "app", "-c", "SELECT pg_sleep(60)"],
      {
        timeoutInMs: STARTUP_TIMEOUT_IN_MS,
      },
    );
    // Seeing the backend in pg_stat_activity proves the forced reset has a connection to terminate.
    await waitForConnection(sql, Date.now() + STARTUP_TIMEOUT_IN_MS);

    const restore = commands.restore("/tmp/backup.dump");
    await using _restoreCleanup = {
      [Symbol.asyncDispose]: async () => {
        await Promise.all(
          restore.cleanup.map(async (command) => await docker(["exec", name, ...command])),
        );
      },
    };
    for (const command of restore.commands) {
      await docker(["exec", name, ...command]);
    }
    const interrupted: ProcessResult = await connected;

    expect(interrupted.exitCode).not.toBe(0);
    expect(await sql("SELECT value FROM original")).toBe("before");
    expect(await sql("SELECT count(*) FROM pg_namespace WHERE nspname = 'later'")).toBe("0");
  },
  COMMAND_TIMEOUT_IN_MS,
);

async function waitForConnection(
  sql: (statement: string) => Promise<string>,
  deadline: number,
): Promise<void> {
  if (
    (await sql(
      "SELECT count(*) FROM pg_stat_activity WHERE datname = 'app' AND query = 'SELECT pg_sleep(60)' AND state = 'active'",
    )) === "1"
  ) {
    return;
  }
  if (Date.now() >= deadline) {
    throw new Error("PostgreSQL fixture connection did not start");
  }
  await Bun.sleep(POLL_INTERVAL_IN_MS);
  await waitForConnection(sql, deadline);
}
