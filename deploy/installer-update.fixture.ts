import { Database } from "bun:sqlite";
import { expect } from "bun:test";
import {
  copyFile,
  mkdir,
  readFile,
  readlink,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

const RELEASE_IMAGE =
  "ghcr.io/nelcota/nelcotadeploy@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const LOCAL_RELEASE_IMAGE = "nelcota-deploy:installer-test-update";
const RELEASE_FILES = [
  "docker-compose.yml",
  "deploy/compose.install.yml",
  "deploy/traefik/panel.yml",
];
const PRIVATE_MODE = 0o600;
const PERMISSION_BITS = 0o777;
const APPLY_MIGRATION = `import { Database } from "bun:sqlite";
  const database = new Database("/data/nelcota.db");
  database.run("CREATE TABLE IF NOT EXISTS installer_update_test (id INTEGER PRIMARY KEY)");`;

type UpdateFixture = {
  readonly bin: string;
  readonly installDirectory: string;
  readonly savedEnvironment: string;
  readonly runUpdate: (script: string) => Promise<{
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  }>;
  readonly checkLogin: () => Promise<void>;
};

async function prepareRelease(bin: string): Promise<string> {
  const release = join(bin, "release");
  await mkdir(join(release, "deploy/traefik"), { recursive: true });
  await Promise.all(
    ["install.sh", "deploy/update.sh", ...RELEASE_FILES].map(
      async (path) => await copyFile(path, join(release, path)),
    ),
  );
  await writeFile(join(release, "deploy/release-image"), `${RELEASE_IMAGE}\n`);
  const overridePath = join(release, "deploy/compose.install.yml");
  const override = await readFile(overridePath, "utf8");
  const command = `bun run db:migrate && bun -e '${APPLY_MIGRATION}' && bun run start`;
  await writeFile(
    overridePath,
    `${override}\nservices:\n  web:\n    command: ${JSON.stringify(["sh", "-c", command])}\n`,
  );
  return join(release, "install.sh");
}

async function useLocalReleaseImage(bin: string) {
  const docker = Bun.which("docker");
  if (docker == null) {
    throw new Error("Docker is required for the installer test");
  }

  const build = Bun.spawn([docker, "build", "--tag", LOCAL_RELEASE_IMAGE, "-"], {
    stdin: new Response('FROM nelcota-deploy:local\nLABEL installer-test-release="update"\n'),
    stderr: "pipe",
  });
  expect(await build.exited, await new Response(build.stderr).text()).toBe(0);

  // Resolve the test digest to a local image while leaving the Compose operations intact.
  await writeFile(
    join(bin, "docker"),
    `#!/bin/bash
case " $* " in
  *' compose '*'pull web traefik ')
    exec "${docker}" "\${@:1:$#-2}" traefik
    ;;
  *' compose '*'up '*)
    export NELCOTA_IMAGE=${LOCAL_RELEASE_IMAGE}
    ;;
esac

exec "${docker}" "$@"
`,
    { mode: 0o700 },
  );
}

async function checkBackup(backup: string, savedEnvironment: string) {
  const environment = join(backup, ".env");
  const databasePath = join(backup, "nelcota.db");
  expect(await readFile(environment, "utf8")).toBe(savedEnvironment);
  expect((await stat(environment)).mode & PERMISSION_BITS).toBe(PRIVATE_MODE);
  expect((await stat(databasePath)).mode & PERMISSION_BITS).toBe(PRIVATE_MODE);
  expect(await Bun.file(join(backup, "docker-compose.override.yml")).text()).not.toContain(
    APPLY_MIGRATION,
  );

  using database = new Database(databasePath, { readonly: true });
  expect(database.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  expect(database.query('SELECT email FROM "user"').get()).toEqual({ email: "admin@example.com" });
  expect(
    database.query("SELECT name FROM sqlite_master WHERE name = 'installer_update_test'").get(),
  ).toBeNull();
}

async function checkLiveMigration(expected: "applied" | "absent") {
  const migration = Bun.spawn(
    [
      "docker",
      "exec",
      "nelcota-web-1",
      "bun",
      "-e",
      `import { Database } from "bun:sqlite";
      using database = new Database("/data/nelcota.db", { readonly: true });
      const table = database.query("SELECT name FROM sqlite_master WHERE name = 'installer_update_test'").get();
      console.log(table === null ? "absent" : "applied");`,
    ],
    { stderr: "pipe", stdout: "pipe" },
  );
  expect(await migration.exited, await new Response(migration.stderr).text()).toBe(0);
  expect((await new Response(migration.stdout).text()).trim()).toBe(expected);
}

async function checkDocumentedRecovery(fixture: UpdateFixture, backup: string) {
  const readme = await Bun.file("README.md").text();
  const recovery = /```bash\n(\(\n  set -eu\n  cd \/opt\/nelcota-deploy\n[\s\S]*?)\n```/.exec(
    readme,
  )?.[1];
  if (recovery == null) {
    throw new Error("The README is missing the release recovery commands");
  }

  const restore = Bun.spawn(["bash", "-s"], {
    stdin: new Response(recovery.replace(/\n  backup=[^\n]+/, `\n  backup=${backup}`)),
    stderr: "pipe",
  });
  expect(await restore.exited, await new Response(restore.stderr).text()).toBe(0);
  expect(await readFile(join(fixture.installDirectory, ".env"), "utf8")).toBe(
    fixture.savedEnvironment,
  );
  await checkLiveMigration("absent");
  await fixture.checkLogin();
}

export async function checkReleaseUpdate(fixture: UpdateFixture) {
  const script = await prepareRelease(fixture.bin);
  const backupRoot = join(fixture.installDirectory, "update-backups");
  const pending = join(backupRoot, "pending");
  const publicError = join(fixture.bin, "curl.public-error");
  await useLocalReleaseImage(fixture.bin);
  await writeFile(publicError, "");

  const failed = await fixture.runUpdate(script);
  expect(failed.exitCode, failed.stderr).toBe(1);
  expect(failed.stderr).toContain("unavailable through public DNS");
  const backupName = await readlink(pending);
  const backup = join(backupRoot, backupName);
  expect(failed.stderr).toContain(`Update incomplete. Backup: ${backup}`);
  await checkBackup(backup, fixture.savedEnvironment);

  const environment = join(fixture.installDirectory, ".env");
  const currentEnvironment = await readFile(environment, "utf8");
  expect(currentEnvironment).toBe(
    fixture.savedEnvironment.replace(/^NELCOTA_IMAGE=.*$/m, `NELCOTA_IMAGE=${RELEASE_IMAGE}`),
  );
  expect((await stat(environment)).mode & PERMISSION_BITS).toBe(PRIVATE_MODE);
  await checkLiveMigration("applied");
  await rm(publicError);
  await writeFile(join(fixture.bin, "curl.public-timeout"), "");

  const recovered = await fixture.runUpdate(script);
  expect(recovered.exitCode, recovered.stderr).toBe(0);
  expect(recovered.stdout).toContain(`Resuming update with backup ${backup}`);
  expect(recovered.stdout).toContain("Public HTTPS check timed out. Retrying over IPv4");
  expect(recovered.stdout).toContain("Update complete.");
  await fixture.checkLogin();

  const repeated = await fixture.runUpdate(script);
  expect(repeated.exitCode, repeated.stderr).toBe(0);
  expect(repeated.stdout).toContain("This release is already installed.");
  expect(await readdir(backupRoot)).toEqual([backupName]);
  await checkDocumentedRecovery(fixture, backup);
}
