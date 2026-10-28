import { hostname } from "node:os";

import { getConfig } from "@/config";
import { getDatabase } from "@/db";
import { DockerCli } from "@/docker";
import { GitClient } from "@/git";
import { createLogger } from "@/logging";
import { getSecretBox } from "@/secrets";

import { Worker } from "./worker";

const logger = createLogger("worker");
const config = getConfig();
const worker = new Worker({
  workerId: process.env["WORKER_ID"] ?? hostname(),
  database: getDatabase(),
  docker: new DockerCli(config.DOCKER_BINARY),
  git: new GitClient(config.GIT_BINARY),
  secretBox: await getSecretBox(),
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
