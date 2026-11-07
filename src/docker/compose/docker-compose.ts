import { type CommandRunner, failureReason, type OutputStream } from "@/process";

import { LABELS } from "../docker.commands";
import { DockerCommandError } from "../docker.errors";
import { type ComposeProjectFiles, composeConfigArgs, composeUpArgs } from "./compose.commands";

const CONFIG_TIMEOUT_IN_MS = 60_000;
const NETWORK_TIMEOUT_IN_MS = 30_000;

/** Timeout, cancellation and streaming of a long Compose command. */
type ComposeRun = {
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutInMs: number;
  readonly signal?: AbortSignal;
  readonly onLine?: (line: string, stream: OutputStream) => void;
};

/**
 * Docker Compose on one host, through the `docker compose` plugin. Like {@link DockerCli}, it
 * runs every command through the runner, so it works the same on this host and over SSH.
 */
export class DockerCompose {
  readonly #binary: string;
  readonly #runner: CommandRunner;

  /**
   * Reaches the Compose plugin of one host.
   *
   * @param binary - Docker CLI executable on the host the runner reaches.
   * @param runner - Where commands run.
   */
  constructor(binary: string, runner: CommandRunner) {
    this.#binary = binary;
    this.#runner = runner;
  }

  /**
   * Prints the normalized model of a Compose project without starting anything.
   *
   * @param project - Name, files and folder of the Compose project.
   * @param env - Values the files interpolate.
   * @returns The model, as parsed JSON, still to be validated.
   * @throws {DockerCommandError} When Compose rejects the files or prints no JSON.
   */
  async renderConfig(
    project: ComposeProjectFiles,
    env: Readonly<Record<string, string>>,
  ): Promise<unknown> {
    const result = await this.#runner([this.#binary, ...composeConfigArgs(project)], {
      env,
      timeoutInMs: CONFIG_TIMEOUT_IN_MS,
    });
    if (result.exitCode !== 0) {
      throw new DockerCommandError(
        `docker compose config failed: ${failureReason(result)}`,
        result.exitCode,
      );
    }
    try {
      const parsed: unknown = JSON.parse(result.stdout);
      return parsed;
    } catch (error) {
      throw new DockerCommandError(
        `docker compose config printed no JSON: ${error instanceof Error ? error.message : String(error)}`,
        result.exitCode,
      );
    }
  }

  /**
   * Builds and starts the services of a Compose project.
   *
   * @param project - Name, files and folder of the Compose project.
   * @param run - Values the services receive and interpolate, timeout, cancellation and output.
   * @throws {DockerCommandError} When a build or a service fails to start.
   */
  async up(project: ComposeProjectFiles, run: ComposeRun): Promise<void> {
    const result = await this.#runner([this.#binary, ...composeUpArgs(project)], {
      env: run.env,
      timeoutInMs: run.timeoutInMs,
      ...(run.signal == null ? {} : { signal: run.signal }),
      ...(run.onLine == null ? {} : { onLine: run.onLine }),
    });
    if (result.exitCode !== 0) {
      throw new DockerCommandError(
        `docker compose up failed${result.timedOut ? " (timed out)" : ""}: ${failureReason(result)}`,
        result.exitCode,
      );
    }
  }

  /**
   * Removes the networks Compose created for a project, once its containers are gone.
   *
   * @param projectId - Owning project.
   * @returns How many networks were removed.
   * @throws {DockerCommandError} When docker cannot list them.
   */
  async removeProjectNetworks(projectId: string): Promise<number> {
    const list = await this.#runner(
      [
        this.#binary,
        "network",
        "ls",
        "--quiet",
        "--filter",
        `label=${LABELS.managed}=true`,
        "--filter",
        `label=${LABELS.projectId}=${projectId}`,
      ],
      { timeoutInMs: NETWORK_TIMEOUT_IN_MS },
    );
    if (list.exitCode !== 0) {
      throw new DockerCommandError(
        `docker network ls failed: ${failureReason(list)}`,
        list.exitCode,
      );
    }
    const ids = list.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    if (ids.length === 0) {
      return 0;
    }
    const removal = await this.#runner([this.#binary, "network", "rm", "--", ...ids], {
      timeoutInMs: NETWORK_TIMEOUT_IN_MS,
    });
    if (removal.exitCode !== 0) {
      throw new DockerCommandError(
        `docker network rm failed: ${failureReason(removal)}`,
        removal.exitCode,
      );
    }
    return ids.length;
  }
}

/** Public operations of {@link DockerCompose}, so tests can provide an in-memory double. */
export type DockerComposeStore = {
  [K in keyof DockerCompose]: DockerCompose[K];
};
