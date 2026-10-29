import type { Logger } from "pino";

import type { AppConfig } from "@/config";
import type { Database } from "@/db";
import type { DockerEngine } from "@/docker";
import type { GitClient } from "@/git";
import type { CommandRunner } from "@/process";
import type { RouteFiles } from "@/routing";
import type { SecretBox } from "@/secrets";

import type { Probes } from "./probes";
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
};

/** Everything the worker uses to work on one server, wherever it is. */
export type ServerHost = {
  readonly serverId: string;
  /** Runs commands on the server. */
  readonly runner: CommandRunner;
  readonly docker: DockerEngine;
  readonly git: Pick<GitClient, "checkoutRevision">;
  /** Health probes that reach containers on the server's Docker network. */
  readonly probes: Probes;
  /** Where builds run on the server; its filesystem is the disk reported for the server. */
  readonly workspaceDir: string;
  /**
   * Whether the platform runs this server's proxy itself (servers reached over SSH). That
   * proxy always routes, and does not compress on its entrypoint like the panel's own does,
   * so application containers bring their own compression middleware.
   */
  readonly platformProxy: boolean;
  /** Route files the server's proxy reads; null when nothing routes traffic there. */
  readonly routes: RouteFiles | null;
  /** Opens the connection now; does nothing for the local host. */
  readonly connect: () => Promise<void>;
  /** Host key the server presented on the last connection; null for the local host. */
  readonly hostKeyFingerprint: () => string | null;
};
