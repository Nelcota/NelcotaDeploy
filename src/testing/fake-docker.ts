import type { ContainerInfo, DockerEngine, OutputHandler } from "@/docker";
import type { ProcessResult } from "@/process";

import { FakeCompose } from "./fake-compose";
import { FakeImages } from "./fake-images";
import { FakeVolumes } from "./fake-volumes";
import { fromShellPath } from "./shell-path";

/** In-memory Docker double that records calls and simulates containers. */
export class FakeDocker implements DockerEngine {
  readonly calls: string[] = [];
  readonly containers = new Map<string, ContainerInfo>();
  readonly environments = new Map<string, Readonly<Record<string, string>>>();
  readonly definitions = new Map<string, Parameters<DockerEngine["runContainer"]>[0]>();
  readonly images = new FakeImages(this.calls);
  readonly compose = new FakeCompose(
    this.calls,
    this.containers,
    async (path) => await Bun.file(fromShellPath(path)).text(),
  );
  readonly volumes = new FakeVolumes(this.calls, (name) =>
    [...this.mounts.entries()].some(
      ([container, volumes]) =>
        this.containers.has(container) && volumes.some((volume) => volume.name === name),
    ),
  );
  /** Volumes each container mounts, by container name. */
  readonly mounts = new Map<string, readonly { name: string; target: string }[]>();
  /** When set, `buildImage` prints this line and fails. */
  buildFailure: string | null = null;
  /** When false, started containers exit immediately. */
  containersStayUp = true;
  /** When set, `execInContainer` prints this line on stderr and exits with 1. */
  execFailure: string | null = null;

  async serverVersion(): Promise<string | null> {
    return await Promise.resolve("fake");
  }

  async buildImage(
    options: Parameters<DockerEngine["buildImage"]>[0],
    _values: Readonly<Record<string, string>>,
    run: { readonly onLine?: OutputHandler },
  ): Promise<void> {
    this.calls.push(`build ${options.imageTag}`);
    run.onLine?.("#1 building", "stderr");
    if (this.buildFailure != null) {
      run.onLine?.(this.buildFailure, "stderr");
      throw new Error(`docker build failed: ${this.buildFailure}`);
    }
    this.images.tags.add(options.imageTag);
    await Promise.resolve();
  }

  async buildWithRailpack(
    options: Parameters<DockerEngine["buildWithRailpack"]>[0],
    _values: Readonly<Record<string, string>>,
    run: { readonly onLine?: OutputHandler },
  ): Promise<void> {
    this.calls.push(`railpack build ${options.imageTag} secrets=${options.secretKeys.join(",")}`);
    run.onLine?.("#1 railpack", "stderr");
    if (this.buildFailure != null) {
      run.onLine?.(this.buildFailure, "stderr");
      throw new Error(`docker buildx build failed: ${this.buildFailure}`);
    }
    this.images.tags.add(options.imageTag);
    await Promise.resolve();
  }

  /** Bytes each prune reports as freed. */
  reclaimedBytes = 0;

  async pruneBuildCache(limits: Parameters<DockerEngine["pruneBuildCache"]>[0]): Promise<number> {
    this.calls.push(`prune build cache ${limits.retentionInHours}h ${limits.maxUsedSpaceInGb}gb`);
    return await Promise.resolve(this.reclaimedBytes);
  }

  async pruneDanglingImages(): Promise<number> {
    this.calls.push("prune dangling images");
    return await Promise.resolve(this.reclaimedBytes);
  }

  async ensureNetwork(): Promise<void> {
    await Promise.resolve();
  }

  async followContainerEvents(): Promise<void> {
    await Promise.resolve();
  }

  async runContainer(
    options: Parameters<DockerEngine["runContainer"]>[0],
    environmentValues: Readonly<Record<string, string>>,
  ): Promise<string> {
    this.calls.push(`run ${options.containerName} env=${Object.keys(environmentValues).join(",")}`);
    this.mounts.set(options.containerName, options.volumes);
    this.environments.set(options.containerName, environmentValues);
    this.definitions.set(options.containerName, options);
    const id = `id-${options.containerName}`;
    this.containers.set(options.containerName, {
      id,
      name: options.containerName,
      image: options.imageTag,
      status: this.containersStayUp ? "running" : "exited",
      running: this.containersStayUp,
      health: null,
      restartCount: 0,
      startedAt: new Date().toISOString(),
      labels: options.labels,
      networkAddresses: { [options.network]: "10.0.0.2" },
    });
    return await Promise.resolve(id);
  }

  #find(reference: string): ContainerInfo | undefined {
    return (
      this.containers.get(reference) ??
      [...this.containers.values()].find((container) => container.id === reference)
    );
  }

  async inspectContainers(references: readonly string[]): Promise<ContainerInfo[]> {
    const found = references
      .map((reference) => this.#find(reference))
      .filter((info) => info != null);
    return await Promise.resolve(found);
  }

  async inspectContainer(reference: string): Promise<ContainerInfo | null> {
    return await Promise.resolve(this.#find(reference) ?? null);
  }

  async readContainerEnvironment(reference: string): Promise<readonly string[]> {
    const container = this.#find(reference);
    return await Promise.resolve(
      Object.values(this.environments.get(container?.name ?? reference) ?? {}),
    );
  }

  async listManagedContainers(): Promise<ContainerInfo[]> {
    return await Promise.resolve([...this.containers.values()]);
  }

  async #setRunning(reference: string, running: boolean, verb: string): Promise<void> {
    const container = this.#find(reference);
    if (container == null) {
      throw new Error(`no container ${reference}`);
    }
    this.calls.push(`${verb} ${container.name}`);
    this.containers.set(container.name, {
      ...container,
      running,
      status: running ? "running" : "exited",
    });
    await Promise.resolve();
  }

  async startContainer(reference: string): Promise<void> {
    await this.#setRunning(reference, true, "start");
  }

  async stopContainer(reference: string, graceInSeconds?: number): Promise<void> {
    await this.#setRunning(
      reference,
      false,
      graceInSeconds == null ? "stop" : `stop(${graceInSeconds}s)`,
    );
  }

  async restartContainer(reference: string): Promise<void> {
    await this.#setRunning(reference, true, "restart");
  }

  async removeContainer(reference: string): Promise<void> {
    const container = this.#find(reference);
    if (container == null) {
      throw new Error(`no container ${reference}`);
    }
    this.calls.push(`rm ${container.name}`);
    this.containers.delete(container.name);
    await Promise.resolve();
  }

  async readContainerLogs(): Promise<{ line: string; stream: "stdout" | "stderr" }[]> {
    return await Promise.resolve([{ line: "app crashed", stream: "stderr" }]);
  }

  async followContainerLogs(
    _reference: string,
    _onLine: OutputHandler,
    _window: { readonly since: string; readonly signal: AbortSignal },
  ): Promise<void> {
    await Promise.resolve();
  }

  async sampleStats(): Promise<[]> {
    return await Promise.resolve([]);
  }

  async copyFromContainer(
    reference: string,
    containerPath: string,
    hostPath: string,
  ): Promise<void> {
    this.calls.push(`cp ${reference}:${containerPath} ${hostPath}`);
    await Promise.resolve();
  }

  async copyToContainer(hostPath: string, reference: string, containerPath: string): Promise<void> {
    this.calls.push(`cp ${hostPath} ${reference}:${containerPath}`);
    await Promise.resolve();
  }

  async execInContainer(
    reference: string,
    command: readonly string[],
    _run: Parameters<DockerEngine["execInContainer"]>[2],
  ): Promise<ProcessResult> {
    this.calls.push(`exec ${reference} ${command.join(" ")}`);
    return await Promise.resolve({
      exitCode: this.execFailure == null ? 0 : 1,
      stdout: "done\n",
      stderr: this.execFailure == null ? "" : `${this.execFailure}\n`,
      timedOut: false,
      aborted: false,
    });
  }
}
