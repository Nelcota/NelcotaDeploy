import { Database as Sqlite } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { backupDatabase, listBackups, selectExpiredBackups } from "./backup";
import { openMemoryDatabase } from "./database";

const DAY_IN_MS = 86_400_000;

describe("selectExpiredBackups", () => {
  test("keeps the newest backups and ignores other files", () => {
    const names = [
      "nelcota-20261027T033000Z.db",
      "nelcota-20261029T033000Z.db",
      "notes.txt",
      "nelcota-20261028T033000Z.db",
    ];

    expect(selectExpiredBackups(names, 2)).toEqual(["nelcota-20261027T033000Z.db"]);
  });

  test("deletes nothing while there are fewer backups than kept", () => {
    expect(selectExpiredBackups(["nelcota-20261029T033000Z.db"], 7)).toEqual([]);
  });

  test.each([[0], [-1], [1.5]])("throws RangeError when kept is %p", (kept) => {
    expect(() => selectExpiredBackups([], kept)).toThrow(RangeError);
  });
});

describe("backupDatabase", () => {
  test("writes a readable copy and keeps only the newest ones", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nelcota-backup-"));
    const database = openMemoryDatabase();
    const start = new Date("2026-10-27T03:30:00Z").getTime();

    await backupDatabase(database, { directory, kept: 2, now: new Date(start) });
    await backupDatabase(database, { directory, kept: 2, now: new Date(start + DAY_IN_MS) });
    const newest = await backupDatabase(database, {
      directory,
      kept: 2,
      now: new Date(start + 2 * DAY_IN_MS),
    });

    expect((await readdir(directory)).toSorted()).toEqual([
      "nelcota-20261028T033000Z.db",
      "nelcota-20261029T033000Z.db",
    ]);
    const copy = new Sqlite(newest, { readonly: true });
    expect(copy.query("SELECT id FROM servers").all()).toEqual([{ id: "local" }]);
    copy.close();
  });

  test("lists no backups for a directory that does not exist yet", async () => {
    expect(await listBackups(join(tmpdir(), `nelcota-missing-${crypto.randomUUID()}`))).toEqual([]);
  });
});
