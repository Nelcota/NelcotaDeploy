import { z } from "zod";

import { type OutputStream, type ProcessResult, runProcess } from "@/process";

import {
  assertContainerReference,
  assertImageReference,
  buildImageArgs,
  type BuildImageOptions,
  LABELS,
  runContainerArgs,
  type RunContainerOptions,
} from "./docker.commands";
import { DockerCommandError, UnmanagedResourceError } from "./docker.errors";

const QUICK_COMMAND_TIMEOUT_IN_MS = 30_000;
const STOP_TIMEOUT_IN_MS = 60_000;
const BYTES_PER_UNIT: Record<string, number> = {
  B: 1,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
  TIB: 1024 ** 4,
};

/** State of a container as reported by `docker inspect`. */
export type ContainerInfo = {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly status: string;
  readonly running: boolean;
  readonly health: string | null;
  readonly restartCount: number;
  readonly startedAt: string | null;
  readonly labels: Readonly<Record<string, string>>;
  /** IP address per attached network. */
  readonly networkAddresses: Readonly<Record<string, string>>;
};

/** Resource usage of one container from `docker stats`. */
export type ContainerStats = {
  readonly name: string;
  readonly cpuPercent: number | null;
  readonly memoryUsedBytes: number | null;
  readonly memoryLimitBytes: number | null;
};

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
 * Every argument goes through `Bun.spawn` as a vector. Mutating operations on an existing
 * container or image first verify the platform label, so containers created by anything
 * else on the host are never started, stopped or removed.
 */
export class DockerCli {
  readonly #binary: string;

  constructor(binary: string) {
    this.#binary = binary;
  }

  async #run(args: readonly string[], options: CommandOptions = {}): Promise<ProcessResult> {
    return await runProcess([this.#binary, ...args], {
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
   * Stops a platform container.
   *
   * @param reference - Name or id.
   * @throws {UnmanagedResourceError} When the container is not managed by the platform.
   */
  async stopContainer(reference: string): Promise<void> {
    const info = await this.#assertManaged(reference);
    await this.#runChecked(["container", "stop", info.id], "stop", {
      timeoutInMs: STOP_TIMEOUT_IN_MS,
    });
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

const ZERO_DATE_PREFIX = "0001-01-01";

// Docker's JSON is trusted but loosely shaped: missing or odd fields fall back to empty values
// instead of failing the whole read.
const text = z.string().optional().catch(undefined);

const inspectSchema = z.array(
  z.object({
    Id: text,
    Name: text,
    RestartCount: z.number().optional().catch(undefined),
    State: z
      .object({
        Status: text,
        Running: z.boolean().optional().catch(undefined),
        StartedAt: text,
        Health: z.object({ Status: text }).nullish().catch(undefined),
      })
      .optional()
      .catch(undefined),
    Config: z
      .object({
        Image: text,
        Labels: z.record(z.string(), z.unknown()).nullish().catch(undefined),
      })
      .optional()
      .catch(undefined),
    NetworkSettings: z
      .object({
        Networks: z
          .record(z.string(), z.object({ IPAddress: text }))
          .nullish()
          .catch(undefined),
      })
      .optional()
      .catch(undefined),
  }),
);

const statsLineSchema = z.object({ Name: text, CPUPerc: text, MemUsage: text });

function nonEmpty(value: string | undefined): string | null {
  return value == null || value === "" ? null : value;
}

/**
 * Parses the JSON array printed by `docker container inspect`.
 *
 * @param output - Raw stdout.
 * @returns Parsed container information; nothing when the output is not a list.
 */
export function parseInspectOutput(output: string): ContainerInfo[] {
  const parsed = inspectSchema.safeParse(JSON.parse(output));
  if (parsed.success === false) {
    return [];
  }
  return parsed.data.map((container) => {
    const startedAt = nonEmpty(container.State?.StartedAt);
    const labels = Object.entries(container.Config?.Labels ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    const networkAddresses = Object.entries(container.NetworkSettings?.Networks ?? {}).flatMap(
      ([name, network]) => {
        const address = nonEmpty(network.IPAddress);
        return address == null ? [] : [[name, address] as const];
      },
    );
    return {
      id: container.Id ?? "",
      name: (container.Name ?? "").replace(/^\//, ""),
      image: container.Config?.Image ?? "",
      status: nonEmpty(container.State?.Status) ?? "unknown",
      running: container.State?.Running === true,
      health: nonEmpty(container.State?.Health?.Status),
      restartCount: container.RestartCount ?? 0,
      startedAt: startedAt == null || startedAt.startsWith(ZERO_DATE_PREFIX) ? null : startedAt,
      labels: Object.fromEntries(labels),
      networkAddresses: Object.fromEntries(networkAddresses),
    };
  });
}

/**
 * Parses a docker size such as "12.5MiB" into bytes.
 *
 * @param text - Size with unit.
 * @returns Bytes, or null when the text is not a size.
 */
export function parseDockerSize(text: string): number | null {
  const match = /^([\d.]+)\s*([A-Za-z]+)$/.exec(text.trim());
  const amount = Number(match?.[1]);
  const multiplier = BYTES_PER_UNIT[(match?.[2] ?? "").toUpperCase()];
  if (multiplier == null || Number.isFinite(amount) === false) {
    return null;
  }
  return Math.round(amount * multiplier);
}

/**
 * Parses `docker stats --format '{{json .}}'` output, one JSON object per line.
 *
 * @param output - Raw stdout.
 * @returns Parsed stats; unparseable values are null, never guessed.
 */
export function parseStatsOutput(output: string): ContainerStats[] {
  return output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const row = statsLineSchema.parse(JSON.parse(line));
      const cpuPercent = Number.parseFloat((row.CPUPerc ?? "").replace("%", ""));
      const [usedText = "", limitText = ""] = (row.MemUsage ?? "").split("/");
      return {
        name: row.Name ?? "",
        cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : null,
        memoryUsedBytes: parseDockerSize(usedText),
        memoryLimitBytes: parseDockerSize(limitText),
      };
    });
}
