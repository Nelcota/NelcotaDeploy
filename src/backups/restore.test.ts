import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTestSecretBox } from "@/testing";

import { RestoreError } from "./backup.errors";
import type { ObjectStore } from "./offsite-backup";
import { newestBackupKey, restoreBackupTo } from "./restore";

const KEY = "nelcota/nelcota-20261029T033000Z.db.enc";

async function storeWith(content: string): Promise<ObjectStore> {
  const box = await createTestSecretBox();
  const encrypted = await box.encryptBytes(
    new TextEncoder().encode(content),
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
    const store = await storeWith("SQLite format 3\0rest of the database");

    await restoreBackupTo(store, await createTestSecretBox(), { key: KEY, output });

    expect(await Bun.file(output).text()).toBe("SQLite format 3\0rest of the database");
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

describe("newestBackupKey", () => {
  test("picks the newest backup and ignores other files", () => {
    expect(
      newestBackupKey([
        "nelcota/nelcota-20261028T033000Z.db.enc",
        "nelcota/notes.txt",
        "nelcota/nelcota-20261029T033000Z.db.enc",
      ]),
    ).toBe("nelcota/nelcota-20261029T033000Z.db.enc");
  });

  test("returns null for a bucket without backups", () => {
    expect(newestBackupKey([])).toBeNull();
  });
});
