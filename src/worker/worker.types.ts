import type { Logger } from "pino";

import type { ObjectStore } from "@/backups";
import type { AppConfig } from "@/config";
import type { Database } from "@/db";
import type { SecretBox } from "@/secrets";

import type { ServerHosts } from "./servers/server-hosts";

/** Everything the worker needs. */
export type WorkerDependencies = {
  readonly workerId: string;
  readonly database: Database;
  /** Docker, git and probes of each server, local or reached over SSH. */
  readonly hosts: ServerHosts;
  readonly secretBox: SecretBox;
  readonly config: AppConfig;
  readonly logger: Logger;
  /** Bucket for off-site database backups; null when none is configured. */
  readonly offsiteStore: ObjectStore | null;
};
