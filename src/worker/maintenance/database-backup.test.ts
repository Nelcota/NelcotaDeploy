import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pino, { type Logger } from "pino";

import { type ObjectStore, readOffsiteStatus } from "@/backups";
import { getConfig } from "@/config";
import { listBackups, openMemoryDatabase } from "@/db";
import { createTestSecretBox } from "@/testing";

import { backupDatabaseIfDue, isBackupDue, runDatabaseBackup } from "./database-backup";

const NOW = new Date("2026-10-29T12:00:00Z");
const DAILY_OCCURRENCE = new Date("2026-10-29T03:30:00Z");

describe("isBackupDue", () => {
  test("is due when there is no backup yet", () => {
    expect(isBackupDue(null, NOW)).toBe(true);
  });

  test("is not due for a backup from a few hours ago", () => {
    expect(isBackupDue("2026-10-29T03:30:00Z", NOW)).toBe(false);
  });

  test("is due once the newest backup is a day old", () => {
    expect(isBackupDue("2026-10-28T12:00:00Z", NOW)).toBe(true);
  });

  test("is due when the stored time cannot be read", () => {
    expect(isBackupDue("not a date", NOW)).toBe(true);
  });
});

function bucket(options: { readonly failing: boolean }) {
  const keys: string[] = [];
  const store: ObjectStore = {
    write: async (key) => {
      if (options.failing) {
        throw new Error("bucket unreachable");
      }
      keys.push(key);
      await Promise.resolve();
    },
    list: async () => await Promise.resolve([...keys]),
    delete: async () => await Promise.resolve(),
    read: async () => await Promise.reject(new Error("not used")),
  };
  return { store, keys };
}

async function backupDependencies(directory: string, store: ObjectStore) {
  return {
    config: { ...getConfig(), BACKUP_DIR: directory, BACKUPS_KEPT: 2 },
    logger: pino({ level: "silent" }),
    secretBox: await createTestSecretBox(),
    offsiteStore: store,
  };
}

async function backupWith(store: ObjectStore, logger?: Logger) {
  const directory = await mkdtemp(join(tmpdir(), "nelcota-backup-duty-"));
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const dependencies = await backupDependencies(directory, store);
  await runDatabaseBackup(
    { ...dependencies, database, logger: logger ?? dependencies.logger },
    NOW,
  );
  return directory;
}

describe("runDatabaseBackup off-site", () => {
  test("sends the new backup to the bucket and records it", async () => {
    const { store, keys } = bucket({ failing: false });

    const directory = await backupWith(store);

    expect(keys).toHaveLength(1);
    expect((await readOffsiteStatus(directory))?.key).toBe(keys[0] ?? "");
  });

  test("records the failure without throwing, since the local backup exists", async () => {
    const { store } = bucket({ failing: true });

    const directory = await backupWith(store);

    expect((await readOffsiteStatus(directory))?.error).toBe("Offsite backup upload failed");
  });

  test("keeps provider diagnostics out of the status file and logs", async () => {
    const { store } = bucket({ failing: false });
    const marker = "fixture-sensitive-storage-detail";
    const failure = new Error(marker);
    failure.name = marker;
    const logs: string[] = [];
    const logger = pino({ level: "error" }, { write: (line) => logs.push(line) });

    const directory = await backupWith({ ...store, write: () => Promise.reject(failure) }, logger);
    const status = await Bun.file(join(directory, "offsite-status.json")).text();

    expect(status).not.toContain(marker);
    expect(logs.join("")).not.toContain(marker);
    expect(logs.join("")).toContain("off-site backup upload failed");
  });

  test("records a successful upload even when the remote retention step fails", async () => {
    const { store, keys } = bucket({ failing: false });

    const directory = await backupWith({
      ...store,
      list: () => Promise.reject(new Error("storage listing failed")),
    });

    expect(keys).toHaveLength(1);
    expect(await readOffsiteStatus(directory)).toMatchObject({ key: keys[0], error: null });
  });
});

test("skips an overlapping worker and still permits panel database writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nelcota-backup-lock-"));
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const { store, keys } = bucket({ failing: false });
  const uploading = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const dependencies = {
    ...(await backupDependencies(directory, {
      ...store,
      write: async (key, bytes) => {
        await store.write(key, bytes);
        uploading.resolve();
        await finish.promise;
      },
    })),
    database,
  };
  const startup = backupDatabaseIfDue(dependencies, DAILY_OCCURRENCE);
  using _upload = { [Symbol.dispose]: () => finish.resolve() };
  await uploading.promise;

  const overlapping = await runDatabaseBackup(dependencies, NOW);
  database.$client.run("CREATE TABLE backup_lock_probe (id INTEGER)");
  finish.resolve();

  expect(overlapping).toBe(false);
  expect(await startup).toBe(true);
  expect(keys).toHaveLength(1);
  expect(await listBackups(directory)).toHaveLength(1);
});

test("creates one backup for each UTC occurrence, including exactly 03:30", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nelcota-backup-daily-"));
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const { store, keys } = bucket({ failing: false });
  const dependencies = { ...(await backupDependencies(directory, store)), database };

  const first = await runDatabaseBackup(dependencies, DAILY_OCCURRENCE);
  const repeated = await runDatabaseBackup(dependencies, NOW);
  const next = await runDatabaseBackup(dependencies, new Date("2026-10-30T03:30:00Z"));

  expect([first, repeated, next]).toEqual([true, false, true]);
  expect(keys).toHaveLength(2);
});

test("rejects an invalid backup timestamp", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nelcota-backup-clock-"));
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const { store } = bucket({ failing: false });
  const dependencies = { ...(await backupDependencies(directory, store)), database };

  const result = await runDatabaseBackup(dependencies, new Date(Number.NaN)).catch(
    (error: unknown) => error,
  );

  expect(result).toHaveProperty("message", "The panel backup time must be a valid date");
});
