import type { DockerEngine } from "@/docker";

type ImageStore = DockerEngine["images"];

/** In-memory images; tests keep one project per double, so every image matches any scope. */
export class FakeImages implements ImageStore {
  readonly tags = new Set<string>();
  readonly #calls: string[];

  /**
   * Creates the store.
   *
   * @param calls - Call log shared with the Docker double.
   */
  constructor(calls: string[]) {
    this.#calls = calls;
  }

  async exists(imageTag: string): Promise<boolean> {
    return await Promise.resolve(this.tags.has(imageTag));
  }

  async listForProject(): Promise<string[]> {
    return await Promise.resolve([...this.tags].toReversed());
  }

  async remove(imageTag: string): Promise<void> {
    this.#calls.push(`rmi ${imageTag}`);
    this.tags.delete(imageTag);
    await Promise.resolve();
  }
}
