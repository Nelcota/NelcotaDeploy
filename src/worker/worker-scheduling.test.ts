import { expect, setSystemTime, spyOn, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ObjectStore } from "@/backups";
import { getConfig } from "@/config";
import { backupDatabase, openMemoryDatabase } from "@/db";
import { createLogger } from "@/logging";
import { createTestSecretBox } from "@/testing";

import { startScheduledDuties } from "./maintenance/scheduled-duties";
import { ServerHosts } from "./servers/server-hosts";
import type { WorkerDependencies } from "./worker.types";

const HOUR_IN_MS = 3_600_000;

function registerBackupSchedule(dependencies: WorkerDependencies) {
  const cron = spyOn(Bun, "cron");
  const jobs = startScheduledDuties(dependencies, (_name, duty) => async () => await duty());
  const callback: unknown = cron.mock.calls.find(([schedule]) => schedule === "30 3 * * *")?.[1];
  return {
    async runDailyBackup() {
      if (typeof callback !== "function") {
        throw new Error("Expected the daily backup callback");
      }

      await (callback as () => Promise<void>)();
    },
    [Symbol.dispose]() {
      for (const job of jobs) {
        job.stop();
      }

      cron.mockRestore();
    },
  };
}

test("schedules backup and disk cleanup in UTC regardless of the host timezone", async () => {
  const config = { ...getConfig(), DATABASE_PATH: ":memory:", BACKUP_DIR: undefined };
  using hosts = new ServerHosts(config, "unused-key");
  const dependencies = {
    workerId: "test",
    database: openMemoryDatabase(),
    hosts,
    secretBox: await createTestSecretBox(),
    config,
    logger: createLogger("test"),
    offsiteStore: null,
  };
  const cron = spyOn(Bun, "cron");
  using _restoreCron = { [Symbol.dispose]: () => cron.mockRestore() };
  const jobs = startScheduledDuties(dependencies, (_name, duty) => async () => {
    await duty();
  });
  using _stopJobs = {
    [Symbol.dispose]: () => {
      for (const job of jobs) {
        job.stop();
      }
    },
  };

  expect(cron).toHaveBeenCalledWith("30 3 * * *", expect.any(Function), { tz: "UTC" });
  expect(cron).toHaveBeenCalledWith("30 4 * * *", expect.any(Function), { tz: "UTC" });
});

test.each([
  { scenario: "reuses an overlapping startup backup", recent: false },
  { scenario: "still runs when startup skipped a recent backup", recent: true },
])("the daily backup $scenario", async ({ recent }) => {
  setSystemTime(new Date("2026-11-12T03:30:00Z"));
  using _clock = { [Symbol.dispose]: () => setSystemTime() };
  const directory = await mkdtemp(join(tmpdir(), "nelcota-backup-schedule-"));
  const config = { ...getConfig(), BACKUP_DIR: directory, BACKUPS_KEPT: 2 };
  const database = openMemoryDatabase();
  using _connection = database.$client;
  using hosts = new ServerHosts(config, "unused-key");
  const uploadStarted = Promise.withResolvers<void>();
  const finishUpload = Promise.withResolvers<void>();
  const keys: string[] = [];
  const offsiteStore: ObjectStore = {
    write: async (key) => {
      keys.push(key);
      uploadStarted.resolve();
      await finishUpload.promise;
    },
    list: () => Promise.resolve([...keys]),
    delete: () => Promise.resolve(),
    read: () => Promise.reject(new Error("not used")),
  };
  if (recent) {
    await backupDatabase(database, { directory, kept: 2, now: new Date(Date.now() - HOUR_IN_MS) });
  }

  using schedule = registerBackupSchedule({
    workerId: "test",
    database,
    hosts,
    secretBox: await createTestSecretBox(),
    config,
    logger: createLogger("test"),
    offsiteStore,
  });
  if (recent === false) {
    await uploadStarted.promise;
  }

  const daily = schedule.runDailyBackup();
  finishUpload.resolve();
  await daily;

  expect(keys).toHaveLength(1);
});
