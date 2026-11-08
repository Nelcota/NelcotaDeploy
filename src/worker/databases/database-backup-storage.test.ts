import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { localObjectStore, type ObjectStore } from "@/backups";
import { getConfig } from "@/config";

import { backupStorage } from "./database-backup-storage";

const DUMP = new Uint8Array([80, 71, 68, 77, 80]);

function memoryBucket(): ObjectStore & { readonly objects: Map<string, Uint8Array<ArrayBuffer>> } {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  return {
    objects,
    write: async (key, data) => {
      objects.set(key, data);
      await Promise.resolve();
    },
    read: async (key) => {
      const data = objects.get(key);
      if (data == null) {
        throw new Error(`NoSuchKey: ${key}`);
      }
      return await Promise.resolve(data);
    },
    list: async (prefix) =>
      await Promise.resolve([...objects.keys()].filter((key) => key.startsWith(prefix))),
    delete: async (key) => {
      objects.delete(key);
      await Promise.resolve();
    },
  };
}

async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "nelcota-backup-storage-"));
  return {
    path,
    [Symbol.asyncDispose]: async () => await rm(path, { recursive: true, force: true }),
  };
}

test("keeps earlier local backups readable after a bucket is enabled", async () => {
  await using directory = await temporaryDirectory();
  const config = { ...getConfig(), BACKUP_DIR: directory.path, BACKUP_S3_PREFIX: "nelcota/" };
  const local = backupStorage({ config, offsiteStore: null });
  const key = "databases/database/old.dump.enc";
  await local.store.write(key, DUMP);
  const bucket = memoryBucket();
  const storage = backupStorage({ config, offsiteStore: bucket });

  const restored = await storage.store.read(key);
  await storage.store.write("nelcota/databases/database/new.dump.enc", DUMP);

  expect(restored).toEqual(DUMP);
  expect(bucket.objects.has("nelcota/databases/database/new.dump.enc")).toBe(true);
  expect(await local.store.list("")).toEqual([key]);
});

test("lists and removes old local dumps together with new bucket dumps", async () => {
  await using directory = await temporaryDirectory();
  const local = localObjectStore(directory.path);
  const oldKey = "databases/database/old.dump.enc";
  const newKey = "nelcota/databases/database/new.dump.enc";
  await local.write(oldKey, DUMP);
  await local.write("databases/another/keep.dump.enc", DUMP);
  const bucket = memoryBucket();
  await bucket.write(newKey, DUMP);
  const storage = backupStorage({
    config: { ...getConfig(), BACKUP_DIR: directory.path, BACKUP_S3_PREFIX: "nelcota/" },
    offsiteStore: bucket,
  });

  const keys = await storage.store.list("nelcota/databases/database/");
  await Promise.all(keys.map(async (key) => await storage.store.delete(key)));

  expect(keys.toSorted()).toEqual([oldKey, newKey].toSorted());
  expect(await local.list("")).toEqual(["databases/another/keep.dump.enc"]);
  expect(bucket.objects.size).toBe(0);
});

test("reads bucket dumps when no local file exists", async () => {
  await using directory = await temporaryDirectory();
  const bucket = memoryBucket();
  const key = "nelcota/databases/database/new.dump.enc";
  await bucket.write(key, DUMP);
  const storage = backupStorage({
    config: { ...getConfig(), BACKUP_DIR: directory.path },
    offsiteStore: bucket,
  });

  expect(await storage.store.read(key)).toEqual(DUMP);
  const failure = await storage.store.read("missing.dump.enc").catch((error: unknown) => error);
  expect(failure).toMatchObject({ message: "NoSuchKey: missing.dump.enc" });
});

test("removes legacy local dumps without sending keys outside the bucket's allowed prefix", async () => {
  await using directory = await temporaryDirectory();
  const local = localObjectStore(directory.path);
  const key = "databases/database/old.dump.enc";
  await local.write(key, DUMP);
  const bucket = memoryBucket();
  const storage = backupStorage({
    config: { ...getConfig(), BACKUP_DIR: directory.path, BACKUP_S3_PREFIX: "nelcota/" },
    offsiteStore: {
      ...bucket,
      delete: async (remoteKey) => {
        if (remoteKey.startsWith("nelcota/") === false) {
          throw new Error("AccessDenied: key is outside the bucket policy");
        }
        await bucket.delete(remoteKey);
      },
    },
  });

  await storage.store.delete(key);
  await storage.store.delete(key);

  expect(await local.list("")).toEqual([]);
});

test("does not hide local path validation failures behind the bucket", async () => {
  await using directory = await temporaryDirectory();
  const bucket = memoryBucket();
  await bucket.write("../outside", DUMP);
  const storage = backupStorage({
    config: { ...getConfig(), BACKUP_DIR: directory.path },
    offsiteStore: bucket,
  });

  const failure = await storage.store.read("../outside").catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(RangeError);
});

test("uses a bucket without a local backup directory", async () => {
  const bucket = memoryBucket();
  const { BACKUP_DIR: _directory, ...config } = getConfig();
  const storage = backupStorage({ config, offsiteStore: bucket });

  await storage.store.write("new.dump.enc", DUMP);

  expect(await storage.store.read("new.dump.enc")).toEqual(DUMP);
  expect(storage.prefix).toBe(config.BACKUP_S3_PREFIX);
});

test("refuses backups without a bucket or local backup directory", () => {
  const { BACKUP_DIR: _directory, ...config } = getConfig();

  expect(() => backupStorage({ config, offsiteStore: null })).toThrow("Database backups need");
});
