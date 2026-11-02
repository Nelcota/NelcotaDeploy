import type { ContainerInfo, DockerEngine } from "@/docker";

type ComposeStore = DockerEngine["compose"];
type ComposeProject = Parameters<ComposeStore["up"]>[0];

/**
 * In-memory Docker Compose: `renderConfig` returns {@link model}, and `up` starts one
 * container per service of the file it was given, with the labels that file sets.
 */
export class FakeCompose implements ComposeStore {
  /** What `renderConfig` returns for the project folder, as `docker compose config` would. */
  model: (directory: string) => unknown = () => ({ services: {} });
  /** When set, `up` fails with this message. */
  upFailure: string | null = null;
  /** Files `up` read, parsed, in order. */
  readonly upFiles: unknown[] = [];
  /** Environment each `up` ran with, in order. */
  readonly upEnvironments: Readonly<Record<string, string>>[] = [];
  readonly #calls: string[];
  readonly #containers: Map<string, ContainerInfo>;
  readonly #readFile: (path: string) => Promise<string>;

  /**
   * Creates the double.
   *
   * @param calls - Call log shared with the Docker double.
   * @param containers - Containers of the Docker double, where `up` adds the services.
   * @param readFile - Reads a file the deployment wrote, from the same machine as the test.
   */
  constructor(
    calls: string[],
    containers: Map<string, ContainerInfo>,
    readFile: (path: string) => Promise<string>,
  ) {
    this.#calls = calls;
    this.#containers = containers;
    this.#readFile = readFile;
  }

  async renderConfig(project: ComposeProject): Promise<unknown> {
    this.#calls.push(`compose config ${project.projectName}`);
    return await Promise.resolve(this.model(project.directory));
  }

  async up(project: ComposeProject, run: Parameters<ComposeStore["up"]>[1]): Promise<void> {
    this.#calls.push(`compose up ${project.projectName}`);
    this.upEnvironments.push(run.env);
    if (this.upFailure != null) {
      throw new Error(this.upFailure);
    }
    const [file = ""] = project.files;
    const parsed: unknown = JSON.parse(await this.#readFile(file));
    this.upFiles.push(parsed);
    const services = isRecord(parsed) && isRecord(parsed["services"]) ? parsed["services"] : {};
    const networks = isRecord(parsed) && isRecord(parsed["networks"]) ? parsed["networks"] : {};
    // Every container gets an address on each named network of the file, as on Docker.
    const networkAddresses = Object.fromEntries(
      Object.values(networks)
        .map((network) => (isRecord(network) ? network["name"] : null))
        .filter((name): name is string => typeof name === "string")
        .map((name) => [name, "10.0.0.3"]),
    );
    for (const [service, definition] of Object.entries(services)) {
      const labels =
        isRecord(definition) && isRecord(definition["labels"]) ? definition["labels"] : {};
      const name = `${project.projectName}-${service}-1`;
      this.#containers.set(name, {
        id: `id-${name}`,
        name,
        image: `${project.projectName}-${service}`,
        status: "running",
        running: true,
        health: null,
        restartCount: 0,
        startedAt: new Date().toISOString(),
        labels: {
          ...Object.fromEntries(Object.entries(labels).map(([key, value]) => [key, String(value)])),
          "com.docker.compose.service": service,
        },
        networkAddresses,
      });
    }
  }

  async removeProjectNetworks(projectId: string): Promise<number> {
    this.#calls.push(`network rm project=${projectId}`);
    return await Promise.resolve(0);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && Array.isArray(value) === false;
}
