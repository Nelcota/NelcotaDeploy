import type { DockerEngine } from "@/docker";
import type { GitClient } from "@/git";
import type { CommandRunner } from "@/process";
import type { RouteFiles } from "@/routing";

import type { Probes } from "./probes";

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
