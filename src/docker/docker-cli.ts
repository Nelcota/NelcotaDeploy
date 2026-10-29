import { type CommandRunner, type OutputStream, type ProcessResult, runProcess } from "@/process";

import { DockerVolumes, type DockerVolumeStore } from "./docker-volumes";
import {
  assertContainerReference,
  assertImageReference,
  buildImageArgs,
  type BuildImageOptions,
  LABELS,
  runContainerArgs,
  type RunContainerOptions,
  stopContainerArgs,
} from "./docker.commands";
import { DockerCommandError, UnmanagedResourceError } from "./docker.errors";
import {
  type ContainerInfo,
  type ContainerStats,
  parseInspectOutput,
  parseStatsOutput,
} from "./docker.output";

const QUICK_COMMAND_TIMEOUT_IN_MS = 30_000;
const STOP_TIMEOUT_IN_MS = 60_000;
const MS_PER_SECOND = 1000;

/** Callback for streamed command output. */
export type OutputHandler = (line: string, stream: OutputStream) => void;

type CommandOptions = {
  readonly timeoutInMs?: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal | undefined;
  readonly onLine?: OutputHandler | undefined;
  readonly cwd?: string;
};

/**
 * Docker Engine access through the docker CLI.
 *
 * @remarks
 * Every argument goes to the runner as a vector: `Bun.spawn` on this host, or an SSH channel
 * to another server, where the CLI talks to that server's own Docker. Mutating operations on
 * an existing container or image first verify the platform label, so containers created by
 * anything else on the host are never started, stopped or removed.
 */
export class DockerCli {
  readonly #binary: string;
  readonly #runner: CommandRunner;
  /** The platform's named volumes on the same host. */
  readonly volumes: DockerVolumeStore;

  /**
   * Reaches the Docker of one host.
   *
   * @param binary - Docker CLI executable on the host the runner reaches.
   * @param runner - Where commands run; this host by default.
   */
  constructor(binary: string, runner: CommandRunner = runProcess) {
    this.#binary = binary;
    this.#runner = runner;
    this.volumes = new DockerVolumes(binary, runner);
  }

  async #run(args: readonly string[], options: CommandOptions = {}): Promise<ProcessResult> {
    return await this.#runner([this.#binary, ...args], {
      timeoutInMs: options.timeoutInMs ?? QUICK_COMMAND_TIMEOUT_IN_MS,
      ...(options.env == null ? {} : { env: options.env }),
      ...(options.signal == null ? {} : { signal: options.signal }),
      ...(options.onLine == null ? {} : { onLine: options.onLine }),
      ...(options.cwd == null ? {} : { cwd: options.cwd }),
    });
  }

  async #runChecked(
    args: readonly string[],
    description: string,
    options: CommandOptions = {},
  ): Promise<string> {
    const result = await this.#run(args, options);
    if (result.exitCode !== 0) {
      const reason = result.timedOut
        ? "timed out"
        : (result.stderr.trim().split("\n").at(-1) ?? "");
      throw new DockerCommandError(`docker ${description} failed: ${reason}`, result.exitCode);
    }
    return result.stdout;
  }

  /**
   * Returns the Docker Engine version, or null when the daemon is unreachable.
   */
  async serverVersion(): Promise<string | null> {
    const result = await this.#run(["version", "--format", "{{.Server.Version}}"]);
    const version = result.stdout.trim();
    return result.exitCode === 0 && version !== "" ? version : null;
  }

  /**
   * Builds an image with BuildKit.
   *
   * @param options - Build definition; see {@link buildImageArgs}.
   * @param buildArgValues - Values for `options.buildArgKeys`, passed via the environment.
   * @param run - Timeout, cancellation and output streaming.
   * @throws {DockerCommandError} When the build fails, times out or is cancelled.
   */
  async buildImage(
    options: BuildImageOptions,
    buildArgValues: Readonly<Record<string, string>>,
    run: {
      readonly timeoutInMs: number;
      readonly signal?: AbortSignal;
      readonly onLine?: OutputHandler;
      readonly cwd: string;
    },
  ): Promise<void> {
    await this.#runChecked(buildImageArgs(options), "build", {
      timeoutInMs: run.timeoutInMs,
      env: { ...buildArgValues, DOCKER_BUILDKIT: "1" },
      signal: run.signal,
      onLine: run.onLine,
      cwd: run.cwd,
    });
  }

  /**
   * Tells whether an image exists locally.
   *
   * @param imageTag - Image reference.
   */
  async imageExists(imageTag: string): Promise<boolean> {
    const result = await this.#run([
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      assertImageReference(imageTag),
    ]);
    return result.exitCode === 0;
  }

  /**
   * Lists platform images of a project, newest first.
   *
   * @param projectId - Owning project.
   * @returns Image references.
   */
  async listProjectImages(projectId: string): Promise<string[]> {
    const output = await this.#runChecked(
      [
        "image",
        "ls",
        "--filter",
        `label=${LABELS.managed}=true`,
        "--filter",
        `label=${LABELS.projectId}=${projectId}`,
        "--format",
        "{{.Repository}}:{{.Tag}}",
      ],
      "image ls",
    );
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && line.includes("<none>") === false);
  }

  /**
   * Removes a platform image. Images without the platform label are refused.
   *
   * @param imageTag - Image reference.
   * @throws {UnmanagedResourceError} When the image is not managed by the platform.
   * @throws {DockerCommandError} When docker fails, for example because a container uses it.
   */
  async removeImage(imageTag: string): Promise<void> {
    const reference = assertImageReference(imageTag);
    const labels = await this.#runChecked(
      ["image", "inspect", "--format", `{{index .Config.Labels "${LABELS.managed}"}}`, reference],
      "image inspect",
    );
    if (labels.trim() !== "true") {
      throw new UnmanagedResourceError(`image ${reference}`);
    }
    await this.#runChecked(["image", "rm", reference], "image rm");
  }

  /**
   * Creates the platform network when it does not exist yet.
   *
   * @param network - Network name.
   */
  async ensureNetwork(network: string): Promise<void> {
    const inspect = await this.#run(["network", "inspect", "--format", "{{.Name}}", "--", network]);
    if (inspect.exitCode === 0) {
      return;
    }
    await this.#runChecked(
      ["network", "create", "--label", `${LABELS.managed}=true`, "--", network],
      "network create",
    );
  }

  /**
   * Creates and starts a container.
   *
   * @param options - Container definition; see {@link runContainerArgs}.
   * @param environmentValues - Values for `options.environmentKeys`, passed via the environment.
   * @returns The container id.
   * @throws {DockerCommandError} When docker fails.
   */
  async runContainer(
    options: RunContainerOptions,
    environmentValues: Readonly<Record<string, string>>,
  ): Promise<string> {
    const output = await this.#runChecked(runContainerArgs(options), "run", {
      env: environmentValues,
    });
    return output.trim();
  }

  /**
   * Inspects containers by name or id.
   *
   * @param references - Names or ids.
   * @returns Information for each container that exists.
   */
  async inspectContainers(references: readonly string[]): Promise<ContainerInfo[]> {
    if (references.length === 0) {
      return [];
    }
    const result = await this.#run([
      "container",
      "inspect",
      ...references.map((reference) => assertContainerReference(reference)),
    ]);
    // Exit code 1 with partial output happens when some references no longer exist.
    if (result.stdout.trim() === "") {
      return [];
    }
    return parseInspectOutput(result.stdout);
  }

  /**
   * Inspects one container.
   *
   * @param reference - Name or id.
   * @returns Container information, or null when it does not exist.
   */
  async inspectContainer(reference: string): Promise<ContainerInfo | null> {
    const [info] = await this.inspectContainers([reference]);
    return info ?? null;
  }

  /**
   * Lists every container carrying the platform label, running or not.
   *
   * @returns Container information.
   */
  async listManagedContainers(): Promise<ContainerInfo[]> {
    const output = await this.#runChecked(
      [
        "container",
        "ls",
        "--all",
        "--quiet",
        "--no-trunc",
        "--filter",
        `label=${LABELS.managed}=true`,
      ],
      "container ls",
    );
    const ids = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    return await this.inspectContainers(ids);
  }

  async #assertManaged(reference: string): Promise<ContainerInfo> {
    const info = await this.inspectContainer(reference);
    if (info == null) {
      throw new DockerCommandError(`container ${reference} does not exist`, 1);
    }
    if (info.labels[LABELS.managed] !== "true") {
      throw new UnmanagedResourceError(`container ${reference}`);
    }
    return info;
  }

  /**
   * Starts a stopped platform container.
   *
   * @param reference - Name or id.
   * @throws {UnmanagedResourceError} When the container is not managed by the platform.
   */
  async startContainer(reference: string): Promise<void> {
    const info = await this.#assertManaged(reference);
    await this.#runChecked(["container", "start", info.id], "start");
  }

  /**
   * Stops a platform container: SIGTERM, then SIGKILL once the grace period ends.
   *
   * @param reference - Name or id.
   * @param graceInSeconds - Time the app gets to finish, between 0 and 300; Docker's default
   *   (10 s) when omitted.
   * @throws {UnmanagedResourceError} When the container is not managed by the platform.
   * @throws {InvalidDockerArgumentError} When the grace period is out of range.
   */
  async stopContainer(reference: string, graceInSeconds?: number): Promise<void> {
    const info = await this.#assertManaged(reference);
    const args = stopContainerArgs(info.id, graceInSeconds);
    // The command itself waits for the grace period, so its timeout must outlast it.
    const timeoutInMs = STOP_TIMEOUT_IN_MS + (graceInSeconds ?? 0) * MS_PER_SECOND;
    await this.#runChecked(args, "stop", { timeoutInMs });
  }

  /**
   * Restarts a platform container.
   *
   * @param reference - Name or id.
   * @throws {UnmanagedResourceError} When the container is not managed by the platform.
   */
  async restartContainer(reference: string): Promise<void> {
    const info = await this.#assertManaged(reference);
    await this.#runChecked(["container", "restart", info.id], "restart", {
      timeoutInMs: STOP_TIMEOUT_IN_MS,
    });
  }

  /**
   * Force-removes a platform container.
   *
   * @param reference - Name or id.
   * @throws {UnmanagedResourceError} When the container is not managed by the platform.
   */
  async removeContainer(reference: string): Promise<void> {
    const info = await this.#assertManaged(reference);
    await this.#runChecked(["container", "rm", "--force", info.id], "rm", {
      timeoutInMs: STOP_TIMEOUT_IN_MS,
    });
  }

  /**
   * Reads the last lines a container wrote.
   *
   * @param reference - Name or id.
   * @param tail - Number of lines.
   * @returns Lines with their stream.
   */
  async readContainerLogs(
    reference: string,
    tail: number,
  ): Promise<{ line: string; stream: OutputStream }[]> {
    const lines: { line: string; stream: OutputStream }[] = [];
    await this.#run(
      [
        "container",
        "logs",
        "--tail",
        String(Math.max(1, Math.trunc(tail))),
        assertContainerReference(reference),
      ],
      { onLine: (line, stream) => lines.push({ line, stream }) },
    );
    return lines;
  }

  /**
   * Follows a container's output until it stops or the signal aborts.
   *
   * @param reference - Name or id.
   * @param onLine - Receives each line with its docker timestamp prefix.
   * @param window - `since`, only lines after this UTC ISO time, and the `signal` that stops
   *   following when aborted.
   */
  async followContainerLogs(
    reference: string,
    onLine: OutputHandler,
    { since, signal }: { readonly since: string; readonly signal: AbortSignal },
  ): Promise<void> {
    await this.#run(
      [
        "container",
        "logs",
        "--follow",
        "--timestamps",
        "--since",
        since,
        assertContainerReference(reference),
      ],
      { timeoutInMs: Number.MAX_SAFE_INTEGER, signal, onLine },
    );
  }

  /**
   * Samples CPU and memory of running containers once.
   *
   * @param references - Container names or ids.
   * @returns One entry per container docker reported.
   */
  async sampleStats(references: readonly string[]): Promise<ContainerStats[]> {
    if (references.length === 0) {
      return [];
    }
    const output = await this.#runChecked(
      [
        "container",
        "stats",
        "--no-stream",
        "--format",
        "{{json .}}",
        ...references.map((reference) => assertContainerReference(reference)),
      ],
      "stats",
    );
    return parseStatsOutput(output);
  }

  /**
   * Calls `onEvent` for each Docker event of a platform container, until `signal` aborts or
   * the stream ends.
   */
  async followContainerEvents(onEvent: () => void, signal: AbortSignal): Promise<void> {
    await this.#run(
      [
        "events",
        "--filter",
        "type=container",
        "--filter",
        `label=${LABELS.managed}=true`,
        "--format",
        "{{.Action}}",
      ],
      { timeoutInMs: Number.MAX_SAFE_INTEGER, signal, onLine: () => onEvent() },
    );
  }

  /**
   * Runs a command inside a platform container, without a shell.
   *
   * @param reference - Name or id.
   * @param command - Argument vector.
   * @param run - Timeout and output streaming.
   * @returns Process result.
   * @throws {UnmanagedResourceError} When the container is not managed by the platform.
   */
  async execInContainer(
    reference: string,
    command: readonly string[],
    run: {
      readonly timeoutInMs: number;
      readonly onLine?: OutputHandler;
      readonly signal?: AbortSignal;
    },
  ): Promise<ProcessResult> {
    const info = await this.#assertManaged(reference);
    return await this.#run(["container", "exec", info.id, ...command], {
      timeoutInMs: run.timeoutInMs,
      onLine: run.onLine,
      signal: run.signal,
    });
  }
}

/** Public operations of {@link DockerCli}, so tests can provide an in-memory double. */
export type DockerEngine = {
  [K in keyof DockerCli]: DockerCli[K];
};
