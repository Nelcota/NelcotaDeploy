import type { Logger } from "pino";

import type { AppConfig } from "@/config";
import type { Database } from "@/db";
import type { DockerEngine } from "@/docker";
import type { GitClient } from "@/git";
import type { SecretBox } from "@/secrets";

/** Everything the worker needs. Tests pass in-memory doubles for Docker and git. */
export type WorkerDependencies = {
  readonly workerId: string;
  readonly database: Database;
  readonly docker: DockerEngine;
  readonly git: Pick<GitClient, "checkoutRevision">;
  readonly secretBox: SecretBox;
  readonly config: AppConfig;
  readonly logger: Logger;
};
