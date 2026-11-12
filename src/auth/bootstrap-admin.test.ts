import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env, execPath } from "node:process";

import { migrateDatabase, openDatabase, tables } from "@/db";

async function runBootstrap(databasePath: string, email: string, password: string) {
  const child = Bun.spawn([execPath, "run", "admin:create", "--if-missing", "--email", email], {
    env: {
      ...env,
      DATABASE_PATH: databasePath,
      BETTER_AUTH_SECRET: "bootstrap-test-secret-with-enough-length",
      NELCOTA_ADMIN_PASSWORD: password,
      LOG_LEVEL: "silent",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function withDatabase(run: (path: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "nelcota-bootstrap-test-"));
  const path = join(directory, "panel.db");
  try {
    const database = openDatabase(path);
    using _connection = database.$client;
    migrateDatabase(database);
    await run(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("admin:create --if-missing", () => {
  test("requires a supplied password before provisioning a fresh database", async () => {
    await withDatabase(async (path) => {
      const result = await runBootstrap(path, "admin@example.com", "");

      expect(result.exitCode).toBe(1);
    });
  });

  test("keeps the original administrator when rerun after deleting the initial password", async () => {
    await withDatabase(async (path) => {
      const password = "a-long-bootstrap-test-password";
      const first = await runBootstrap(path, "admin@example.com", password);
      const retry = await runBootstrap(path, "second@example.com", "");

      expect(first.exitCode).toBe(0);
      expect(retry.exitCode).toBe(0);
      expect(first.stdout + first.stderr).not.toContain(password);
      const database = openDatabase(path);
      using _connection = database.$client;
      expect(database.select({ email: tables.users.email }).from(tables.users).all()).toEqual([
        { email: "admin@example.com" },
      ]);
    });
  });
});
