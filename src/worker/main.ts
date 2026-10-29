import { mkdir } from "node:fs/promises";
import { hostname } from "node:os";

import { getConfig } from "@/config";
import { type Database, getDatabase } from "@/db";
import { createLogger } from "@/logging";
import { generateSshKeyPair } from "@/remote";
import { getSecretBox, type SecretBox } from "@/secrets";
import { LOCAL_SERVER_ID, readPanelPrivateKey, storePanelKeyPair } from "@/servers";

import { createLocalHost, ServerHosts } from "./servers/server-hosts";
import { Worker } from "./worker";

/** Returns the panel's SSH private key, generating the pair on the very first start. */
async function ensurePanelPrivateKey(database: Database, secretBox: SecretBox): Promise<string> {
  const existing = await readPanelPrivateKey(database, secretBox);
  if (existing != null) {
    return existing;
  }
  await storePanelKeyPair(database, secretBox, generateSshKeyPair());
  const stored = await readPanelPrivateKey(database, secretBox);
  if (stored == null) {
    throw new Error("The panel SSH key pair was not stored");
  }
  return stored;
}

const logger = createLogger("worker");
const config = getConfig();
const database = getDatabase();
const secretBox = await getSecretBox();
// Builds need it, and disk usage is measured on the filesystem that holds it.
await mkdir(config.WORKSPACE_DIR, { recursive: true });
const worker = new Worker({
  workerId: process.env["WORKER_ID"] ?? hostname(),
  database,
  hosts: new ServerHosts(
    createLocalHost(config, LOCAL_SERVER_ID),
    await ensurePanelPrivateKey(database, secretBox),
  ),
  secretBox,
  config,
  logger,
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
