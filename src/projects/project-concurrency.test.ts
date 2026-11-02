import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import type { SQLiteTransactionConfig } from "drizzle-orm/sqlite-core";

import { migrateDatabase, openDatabase, tables, type Transaction } from "@/db";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { getProject, updateProject } from "./project.service";

test("reserves the SQLite writer before a project update can read a stale snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nelcota-concurrency-"));
  await using _directory = {
    [Symbol.asyncDispose]: async () => await rm(directory, { recursive: true, force: true }),
  };
  const database = openDatabase(join(directory, "panel.db"));
  using _database = { [Symbol.dispose]: () => database.$client.close(true) };
  migrateDatabase(database);
  const rival = openDatabase(join(directory, "panel.db"));
  using _rival = { [Symbol.dispose]: () => rival.$client.close(true) };
  rival.$client.run("PRAGMA busy_timeout = 1");
  const project = createTestProject(database);
  const transact = database.transaction.bind(database);
  let rivalError: unknown;
  const spy = spyOn(database, "transaction").mockImplementation(
    <T>(callback: (transaction: Transaction) => T, options?: SQLiteTransactionConfig): T =>
      transact((transaction) => {
        try {
          rival
            .update(tables.projects)
            .set({ name: "Competing write" })
            .where(eq(tables.projects.id, project.id))
            .run();
        } catch (error) {
          rivalError = error;
        }
        return callback(transaction);
      }, options),
  );
  using _spy = { [Symbol.dispose]: () => spy.mockRestore() };
  updateProject(database, {
    projectId: project.id,
    input: { ...project, name: "Saved update" },
    editor: { actor: TEST_ACTOR, isAdmin: true },
  });
  expect(rivalError).toBeInstanceOf(Error);
  expect(getProject(database, project.id).name).toBe("Saved update");
});
