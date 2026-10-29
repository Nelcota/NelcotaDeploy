import type { ContainerInfo, DockerEngine, OutputHandler } from "@/docker";
import type { ProcessResult } from "@/process";

/** In-memory Docker double that records calls and simulates containers. */
export class FakeDocker implements DockerEngine {
  readonly calls: string[] = [];
  readonly containers = new Map<string, ContainerInfo>();
  readonly images = new Set<string>();
  /** When set, `buildImage` prints this line and fails. */
  buildFailure: string | null = null;
  /** When false, started containers exit immediately. */
  containersStayUp = true;

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
    this.images.add(options.imageTag);
    await Promise.resolve();
  }

  async imageExists(imageTag: string): Promise<boolean> {
    return await Promise.resolve(this.images.has(imageTag));
  }

  async listProjectImages(): Promise<string[]> {
    return await Promise.resolve([...this.images].toReversed());
  }

  async removeImage(imageTag: string): Promise<void> {
    this.calls.push(`rmi ${imageTag}`);
    this.images.delete(imageTag);
    await Promise.resolve();
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

  async followContainerLogs(): Promise<void> {
    await Promise.resolve();
  }

  async sampleStats(): Promise<[]> {
    return await Promise.resolve([]);
  }

  async execInContainer(reference: string, command: readonly string[]): Promise<ProcessResult> {
    this.calls.push(`exec ${reference} ${command.join(" ")}`);
    return await Promise.resolve({
      exitCode: 0,
      stdout: "done\n",
      stderr: "",
      timedOut: false,
      aborted: false,
    });
  }
}
