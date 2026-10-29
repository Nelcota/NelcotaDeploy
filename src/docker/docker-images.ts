import { type CommandRunner, failureReason, type ProcessResult } from "@/process";

import { assertImageReference, LABELS } from "./docker.commands";
import { DockerCommandError, UnmanagedResourceError } from "./docker.errors";

const COMMAND_TIMEOUT_IN_MS = 30_000;

/** Which images of a project to list: all of them, or those of production or of one preview. */
export type ImageScope = "all" | { readonly previewId: string | null };

/**
 * The platform's images on one host. Only images carrying the platform label are removed.
 */
export class DockerImages {
  readonly #binary: string;
  readonly #runner: CommandRunner;

  /**
   * Reaches the images of one host.
   *
   * @param binary - Docker CLI executable on the host the runner reaches.
   * @param runner - Where commands run.
   */
  constructor(binary: string, runner: CommandRunner) {
    this.#binary = binary;
    this.#runner = runner;
  }

  async #run(args: readonly string[]): Promise<ProcessResult> {
    return await this.#runner([this.#binary, "image", ...args], {
      timeoutInMs: COMMAND_TIMEOUT_IN_MS,
    });
  }

  async #runChecked(args: readonly string[], description: string): Promise<string> {
    const result = await this.#run(args);
    if (result.exitCode !== 0) {
      throw new DockerCommandError(
        `docker image ${description} failed: ${failureReason(result)}`,
        result.exitCode,
      );
    }
    return result.stdout;
  }

  async #list(filters: readonly string[]): Promise<string[]> {
    const output = await this.#runChecked(
      [
        "ls",
        "--filter",
        `label=${LABELS.managed}=true`,
        ...filters.flatMap((filter) => ["--filter", filter]),
        "--format",
        "{{.Repository}}:{{.Tag}}",
      ],
      "ls",
    );
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && line.includes("<none>") === false);
  }

  /**
   * Tells whether an image exists on the host.
   *
   * @param imageTag - Image reference.
   * @returns True when it exists.
   * @throws {InvalidDockerArgumentError} When the reference is malformed.
   */
  async exists(imageTag: string): Promise<boolean> {
    const result = await this.#run([
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
   * @param scope - `"all"`, or `{ previewId }`: one preview's images, or production's for null.
   * @returns Image references.
   * @throws {DockerCommandError} When docker cannot list them.
   */
  async listForProject(projectId: string, scope: ImageScope): Promise<string[]> {
    const project = `label=${LABELS.projectId}=${projectId}`;
    if (scope === "all") {
      return await this.#list([project]);
    }
    if (scope.previewId != null) {
      return await this.#list([project, `label=${LABELS.previewId}=${scope.previewId}`]);
    }
    // Docker filters cannot exclude a label, so preview images are subtracted.
    const [all, previews] = await Promise.all([
      this.#list([project]),
      this.#list([project, `label=${LABELS.previewId}`]),
    ]);
    const previewSet = new Set(previews);
    return all.filter((image) => previewSet.has(image) === false);
  }

  /**
   * Removes a platform image. Images without the platform label are refused.
   *
   * @param imageTag - Image reference.
   * @throws {UnmanagedResourceError} When the image is not managed by the platform.
   * @throws {DockerCommandError} When docker fails, for example because a container uses it.
   */
  async remove(imageTag: string): Promise<void> {
    const reference = assertImageReference(imageTag);
    const labels = await this.#runChecked(
      ["inspect", "--format", `{{index .Config.Labels "${LABELS.managed}"}}`, reference],
      "inspect",
    );
    if (labels.trim() !== "true") {
      throw new UnmanagedResourceError(`image ${reference}`);
    }
    await this.#runChecked(["rm", reference], "rm");
  }
}

/** What callers use of {@link DockerImages}; tests provide their own. */
export type DockerImageStore = { [K in keyof DockerImages]: DockerImages[K] };
