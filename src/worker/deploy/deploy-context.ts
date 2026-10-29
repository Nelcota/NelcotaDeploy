import type { Database } from "@/db";
import type { Deployment } from "@/deployments";
import type { Project } from "@/projects";
import type { SecretBox } from "@/secrets";

import { DeploymentCancelledError } from "../worker.errors";
import type { ServerHost } from "../worker.types";
import type { DeploymentLogWriter } from "./deployment-log-writer";

/** Settings the deploy runner reads from configuration and from the target server. */
export type DeployRunnerConfig = {
  /** Workspace directory on the server that builds. */
  readonly workspaceDir: string;
  readonly network: string;
  readonly buildTimeoutInSeconds: number;
  readonly healthCheckTimeoutInSeconds: number;
  readonly imagesKeptPerProject: number;
  /** Wait after switching the routes, so the proxy applies them before the old container stops. */
  readonly routingSettleInMs: number;
  readonly traefik: {
    readonly httpEntrypoint: string;
    readonly httpsEntrypoint: string;
    readonly certResolver: string;
    /** Adds a compression middleware; off where the proxy compresses on its entrypoint. */
    readonly compress: boolean;
  };
};

/**
 * Everything the deploy runner talks to, all on the server the deployment runs on. Tests
 * replace Docker, git and probes.
 */
export type DeployRunnerDependencies = Pick<ServerHost, "runner" | "docker" | "git" | "routes"> &
  Partial<Pick<ServerHost, "probes">> & {
    readonly database: Database;
    readonly secretBox: SecretBox;
    readonly config: DeployRunnerConfig;
  };

/** Facts learned while deploying that the failure path needs. */
export class DeployState {
  containerName: string | null = null;
  redact: (text: string) => string = (text) => text;

  useContainer(name: string): void {
    this.containerName = name;
  }

  useRedactor(redact: (text: string) => string): void {
    this.redact = redact;
  }
}

/** The deployment being run and what its steps share. */
export type DeployContext = {
  readonly deployment: Deployment;
  readonly project: Project;
  readonly logs: DeploymentLogWriter;
  readonly signal: AbortSignal;
  readonly state: DeployState;
};

export const MILLISECONDS_PER_SECOND = 1000;

export function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DeploymentCancelledError();
  }
}

export function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
