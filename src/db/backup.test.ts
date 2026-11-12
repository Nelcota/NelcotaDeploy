import { Database as Sqlite } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, utimes } from "node:fs/promises";
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

describe("backupDatabase publication", () => {
  test("leaves no published or temporary file when SQLite cannot finish a backup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nelcota-backup-"));
    const database = openMemoryDatabase();
    using _connection = database.$client;
    database.$client.exec("BEGIN");
    using _rollback = { [Symbol.dispose]: () => database.$client.exec("ROLLBACK") };

    const result = await backupDatabase(database, { directory, kept: 1 }).catch(
      (error: unknown) => error,
    );

    expect(result).toBeInstanceOf(Error);
    expect(await readdir(directory)).toEqual([]);
  });

  test("does not replace a backup with the same name", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nelcota-backup-"));
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const target = { directory, kept: 1, now: new Date("2026-10-29T03:30:00Z") };
    database.$client.exec("CREATE TABLE marker (value TEXT); INSERT INTO marker VALUES ('first')");
    const path = await backupDatabase(database, target);
    database.$client.exec("UPDATE marker SET value = 'second'");

    const result = await backupDatabase(database, target).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: "EEXIST" });
    using copy = new Sqlite(path, { readonly: true });
    expect(copy.query("SELECT value FROM marker").get()).toEqual({ value: "first" });
    expect(await readdir(directory)).toEqual(["nelcota-20261029T033000Z.db"]);
  });
});

test("lists regular backups by snapshot time even when their file times changed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nelcota-backup-"));
  const newest = "nelcota-20261029T033000Z.db";
  const older = "nelcota-20261028T033000Z.db";
  const copiedAt = new Date("2026-11-12T15:00:00Z");
  await Bun.write(join(directory, newest), "fixture");
  await Bun.write(join(directory, older), "fixture");
  await utimes(join(directory, older), copiedAt, copiedAt);
  await Bun.write(join(directory, "nelcota-20260230T033000Z.db"), "invalid date");
  await mkdir(join(directory, "nelcota-20261030T033000Z.db"));

  const backups = await listBackups(directory);

  expect(backups).toEqual([
    { name: newest, createdAt: "2026-10-29T03:30:00.000Z" },
    { name: older, createdAt: "2026-10-28T03:30:00.000Z" },
  ]);
});
