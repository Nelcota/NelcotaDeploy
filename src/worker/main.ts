import { mkdir } from "node:fs/promises";
import { hostname } from "node:os";

import { offsiteStoreFromConfig } from "@/backups";
import { getConfig } from "@/config";
import { getDatabase } from "@/db";
import { createLogger } from "@/logging";
import { getSecretBox } from "@/secrets";
import { ensurePanelPrivateKey } from "@/servers";

import { ServerHosts } from "./servers/server-hosts";
import { Worker } from "./worker";

const logger = createLogger("worker");
const config = getConfig();
const database = getDatabase();
const secretBox = await getSecretBox();
// Builds need it, and disk usage is measured on the filesystem that holds it.
await mkdir(config.WORKSPACE_DIR, { recursive: true });
const worker = new Worker({
  workerId: process.env["WORKER_ID"] ?? hostname(),
  database,
  hosts: new ServerHosts(config, await ensurePanelPrivateKey(database, secretBox)),
  secretBox,
  config,
  logger,
  offsiteStore: offsiteStoreFromConfig(config),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutdown requested; finishing running jobs");
    worker.stop();
  });
}
process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "unhandled rejection"));

await worker.run();
process.exit(0);
