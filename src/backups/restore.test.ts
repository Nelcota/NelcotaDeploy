import { Database as Sqlite } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createTestSecretBox } from "@/testing";

import { RestoreError } from "./backup.errors";
import type { ObjectStore } from "./offsite-backup";
import { newestBackupKey, restoreBackupTo } from "./restore";

const KEY = "nelcota/nelcota-20261029T033000Z.db.enc";

function fixtureDatabase(): Uint8Array<ArrayBuffer> {
  using database = new Sqlite(":memory:");
  database.exec("CREATE TABLE marker (value TEXT); INSERT INTO marker VALUES ('original')");
  return new Uint8Array(database.serialize());
}

async function storeWith(content: string | Uint8Array<ArrayBuffer>): Promise<ObjectStore> {
  const box = await createTestSecretBox();
  const encrypted = await box.encryptBytes(
    typeof content === "string" ? new TextEncoder().encode(content) : content,
    "nelcota-20261029T033000Z.db",
  );
  return {
    write: async () => await Promise.resolve(),
    list: async () => await Promise.resolve([KEY]),
    delete: async () => await Promise.resolve(),
    read: async () => await Promise.resolve(encrypted),
  };
}

async function newOutput(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "nelcota-restore-")), "restored.db");
}

describe("restoreBackupTo", () => {
  test("writes the decrypted database to a new file", async () => {
    const output = await newOutput();
    const contents = fixtureDatabase();
    const store = await storeWith(contents);

    await restoreBackupTo(store, await createTestSecretBox(), { key: KEY, output });

    expect(await Bun.file(output).bytes()).toEqual(contents);
    using database = new Sqlite(output, { readonly: true });
    expect(database.query("SELECT value FROM marker").get()).toEqual({ value: "original" });
  });

  test("throws RestoreError instead of overwriting an existing file", async () => {
    const output = await newOutput();
    await Bun.write(output, "live database");
    const store = await storeWith("SQLite format 3\0x");

    const error = await restoreBackupTo(store, await createTestSecretBox(), {
      key: KEY,
      output,
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(RestoreError);
    expect(await Bun.file(output).text()).toBe("live database");
  });

  test("throws RestoreError when the backup is not a SQLite database", async () => {
    const store = await storeWith("not a database");

    const error = await restoreBackupTo(store, await createTestSecretBox(), {
      key: KEY,
      output: await newOutput(),
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(RestoreError);
  });
});

test("refuses to publish a truncated file with a valid SQLite header", async () => {
  const output = await newOutput();
  const store = await storeWith("SQLite format 3\0truncated database");

  const error = await restoreBackupTo(store, await createTestSecretBox(), {
    key: KEY,
    output,
  }).catch((failure: unknown) => failure);

  expect(error).toBeInstanceOf(RestoreError);
  expect(error).toHaveProperty("message", `${KEY} failed the SQLite integrity check`);
  expect(await readdir(dirname(output))).toEqual([]);
});

test("preserves a destination created while the backup is being downloaded", async () => {
  const output = await newOutput();
  const store = await storeWith(fixtureDatabase());
  const secretBox = await createTestSecretBox();
  const downloadStarted = Promise.withResolvers<void>();
  const releaseDownload = Promise.withResolvers<void>();
  const restoring = restoreBackupTo(
    {
      ...store,
      read: async (key, maxBytes) => {
        downloadStarted.resolve();
        await releaseDownload.promise;
        return await store.read(key, maxBytes);
      },
    },
    secretBox,
    { key: KEY, output },
  ).catch((error: unknown) => error);
  await downloadStarted.promise;

  await Bun.write(output, "another process owns this file");
  releaseDownload.resolve();
  const result = await restoring;

  expect(result).toBeInstanceOf(RestoreError);
  expect(await Bun.file(output).text()).toBe("another process owns this file");
  expect(await readdir(dirname(output))).toEqual(["restored.db"]);
});

describe("newestBackupKey", () => {
  test("picks the newest backup and ignores other files", () => {
    expect(
      newestBackupKey(
        [
          "nelcota/nelcota-20261028T033000Z.db.enc",
          "nelcota/notes.db.enc",
          "nelcota/projects/nelcota-20261201T033000Z.db.enc",
          "nelcota/nelcota-20261131T033000Z.db.enc",
          "other/nelcota-20261201T033000Z.db.enc",
          "nelcota/nelcota-20261029T033000Z.db.enc",
        ],
        "nelcota/",
      ),
    ).toBe("nelcota/nelcota-20261029T033000Z.db.enc");
  });

  test("returns null for a bucket without backups", () => {
    expect(newestBackupKey([], "nelcota/")).toBeNull();
  });
});
