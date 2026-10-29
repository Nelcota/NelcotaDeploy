import { describe, expect, test } from "bun:test";
import { mkdtemp, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTestSecretBox } from "@/testing";

import { BackupTooLargeError } from "./backup.errors";
import { downloadBackup, type ObjectStore, uploadBackup } from "./offsite-backup";

/** In-memory bucket. */
function memoryStore(): ObjectStore & { readonly objects: Map<string, Uint8Array<ArrayBuffer>> } {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  return {
    objects,
    write: async (key, data) => {
      objects.set(key, data);
      await Promise.resolve();
    },
    list: async (prefix) =>
      await Promise.resolve([...objects.keys()].filter((key) => key.startsWith(prefix))),
    delete: async (key) => {
      objects.delete(key);
      await Promise.resolve();
    },
    read: async (key) => {
      const object = objects.get(key);
      if (object == null) {
        throw new Error(`no object ${key}`);
      }
      return await Promise.resolve(object);
    },
  };
}

async function localBackup(name: string, content: string): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), "nelcota-offsite-")), name);
  await Bun.write(path, content);
  return path;
}

describe("uploadBackup", () => {
  test("uploads an encrypted copy that downloads back to the same bytes", async () => {
    const store = memoryStore();
    const box = await createTestSecretBox();
    const path = await localBackup("nelcota-20261029T033000Z.db", "SQLite format 3 data");

    const key = await uploadBackup(store, box, { path, prefix: "nelcota/", kept: 3 });

    expect(key).toBe("nelcota/nelcota-20261029T033000Z.db.enc");
    expect(new TextDecoder().decode(store.objects.get(key))).not.toContain("SQLite");
    const restored = await downloadBackup(store, box, key);
    expect(new TextDecoder().decode(restored)).toBe("SQLite format 3 data");
  });

  test("keeps only the newest remote backups and leaves other files alone", async () => {
    const store = memoryStore();
    const box = await createTestSecretBox();
    await store.write("nelcota/nelcota-20261027T033000Z.db.enc", new Uint8Array(1));
    await store.write("nelcota/notes.txt", new Uint8Array(1));
    const path = await localBackup("nelcota-20261029T033000Z.db", "x");

    await uploadBackup(store, box, { path, prefix: "nelcota/", kept: 1 });

    expect([...store.objects.keys()].toSorted()).toEqual([
      "nelcota/nelcota-20261029T033000Z.db.enc",
      "nelcota/notes.txt",
    ]);
  });
});

describe("uploadBackup refusals", () => {
  test("throws RangeError when kept is not a positive integer", async () => {
    const path = await localBackup("nelcota-20261029T033000Z.db", "x");

    const error = await uploadBackup(memoryStore(), await createTestSecretBox(), {
      path,
      prefix: "nelcota/",
      kept: 0,
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(RangeError);
  });

  test("throws BackupTooLargeError for a backup above 512 MiB, before reading it", async () => {
    const path = await localBackup("nelcota-20261029T033000Z.db", "");
    // A sparse file: the size is there without the bytes being written to disk.
    await truncate(path, 600 * 1024 * 1024);

    const error = await uploadBackup(memoryStore(), await createTestSecretBox(), {
      path,
      prefix: "nelcota/",
      kept: 1,
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(BackupTooLargeError);
  });
});
