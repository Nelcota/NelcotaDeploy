import { expect, test } from "bun:test";

import { createTestProject } from "@/testing";

import { migrateDatabase, openDatabase } from "./database";

const MAIN_MIGRATION_COUNT = 27;

test("upgrades main's migration history without losing projects or existing feature tables", async () => {
  const database = openDatabase(":memory:");
  using _connection = database.$client;
  const journal = (await Bun.file(
    new URL("../../drizzle/meta/_journal.json", import.meta.url),
  ).json()) as {
    readonly entries: readonly {
      readonly idx: number;
      readonly when: number;
      readonly tag: string;
    }[];
  };
  database.$client.exec(
    "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
  );
  for (const entry of journal.entries.filter((entry) => entry.idx < MAIN_MIGRATION_COUNT)) {
    const sql = await Bun.file(new URL(`../../drizzle/${entry.tag}.sql`, import.meta.url)).text();
    for (const statement of sql.split("--> statement-breakpoint")) {
      database.$client.exec(statement);
    }
    const hash = new Bun.CryptoHasher("sha256").update(sql).digest("hex");
    database.$client.run("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [
      hash,
      entry.when,
    ]);
  }
  const project = createTestProject(database);

  migrateDatabase(database);
  migrateDatabase(database);

  expect(database.$client.query("SELECT id FROM projects").all()).toEqual([{ id: project.id }]);
  expect(
    database.$client.query("SELECT count(*) AS total FROM __drizzle_migrations").get(),
  ).toEqual({ total: journal.entries.length });
  const tables = database.$client
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);
  expect(tables).toContain("project_members");
  expect(tables).toContain("console_commands");
  expect(tables).toContain("uptime_checks");
  const indexes = database.$client
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'index'")
    .all()
    .map((row) => row.name);
  expect(indexes).toContain("deployments_preview_created_idx");
  expect(indexes).toContain("runtime_logs_deployment_id_idx");
  expect(indexes).toContain("jobs_dedupe_history_idx");
  expect(indexes).not.toContain("deployments_preview_idx");
});
