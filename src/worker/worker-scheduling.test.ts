import { expect, spyOn, test } from "bun:test";

import { getConfig } from "@/config";
import { openMemoryDatabase } from "@/db";
import { createLogger } from "@/logging";
import { createTestSecretBox } from "@/testing";

import { startScheduledDuties } from "./maintenance/scheduled-duties";
import { ServerHosts } from "./servers/server-hosts";

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
