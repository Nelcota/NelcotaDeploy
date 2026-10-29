import type { DockerEngine } from "@/docker";

type VolumeStore = DockerEngine["volumes"];

/** In-memory named volumes; refuses to remove one a container still mounts, like Docker. */
export class FakeVolumes implements VolumeStore {
  /** Volume name to owning project id. */
  readonly owners = new Map<string, string>();
  readonly #calls: string[];
  readonly #isInUse: (name: string) => boolean;

  /**
   * Creates the store.
   *
   * @param calls - Call log shared with the Docker double.
   * @param isInUse - Whether a running container mounts a volume.
   */
  constructor(calls: string[], isInUse: (name: string) => boolean) {
    this.#calls = calls;
    this.#isInUse = isInUse;
  }

  async ensure(name: string, projectId: string): Promise<void> {
    this.owners.set(name, projectId);
    await Promise.resolve();
  }

  async remove(name: string): Promise<void> {
    if (this.#isInUse(name)) {
      throw new Error(`volume ${name} is in use`);
    }
    this.#calls.push(`volume rm ${name}`);
    this.owners.delete(name);
    await Promise.resolve();
  }

  async listForProject(projectId: string): Promise<string[]> {
    const names = [...this.owners.entries()]
      .filter(([, owner]) => owner === projectId)
      .map(([name]) => name);
    return await Promise.resolve(names);
  }
}
