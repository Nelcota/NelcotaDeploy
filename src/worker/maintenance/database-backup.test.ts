import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pino from "pino";

import { type ObjectStore, readOffsiteStatus } from "@/backups";
import { getConfig } from "@/config";
import { openMemoryDatabase } from "@/db";
import { createTestSecretBox } from "@/testing";

import { isBackupDue, runDatabaseBackup } from "./database-backup";

const NOW = new Date("2026-10-29T12:00:00Z");

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

async function backupWith(store: ObjectStore) {
  const directory = await mkdtemp(join(tmpdir(), "nelcota-backup-duty-"));
  await runDatabaseBackup({
    database: openMemoryDatabase(),
    config: { ...getConfig(), BACKUP_DIR: directory, BACKUPS_KEPT: 2 },
    logger: pino({ level: "silent" }),
    secretBox: await createTestSecretBox(),
    offsiteStore: store,
  });
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

    expect((await readOffsiteStatus(directory))?.error).toBe("bucket unreachable");
  });
});
