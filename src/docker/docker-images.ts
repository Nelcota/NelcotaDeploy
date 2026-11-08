import { type CommandRunner, failureReason, type ProcessResult } from "@/process";

import { assertImageReference, isRailpackBaseTag, LABELS } from "./docker.commands";
import { DockerCommandError, UnmanagedResourceError } from "./docker.errors";
import { parseExposedPorts } from "./docker.output";

const COMMAND_TIMEOUT_IN_MS = 30_000;
// A first pull of a public image can take minutes on a slow server connection.
const PULL_TIMEOUT_IN_MS = 600_000;

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

  async #run(
    args: readonly string[],
    timeoutInMs: number = COMMAND_TIMEOUT_IN_MS,
  ): Promise<ProcessResult> {
    return await this.#runner([this.#binary, "image", ...args], { timeoutInMs });
  }

  async #runChecked(
    args: readonly string[],
    description: string,
    timeoutInMs: number = COMMAND_TIMEOUT_IN_MS,
  ): Promise<string> {
    const result = await this.#run(args, timeoutInMs);
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
   * Reads the final image's exposed TCP ports, including ports inherited from its base.
   *
   * @param imageTag - Image reference.
   * @returns Ports in ascending order; empty when the image declares none.
   * @throws {DockerCommandError} When inspection fails or its output is malformed.
   * @throws {InvalidDockerArgumentError} When the reference is malformed.
   */
  async exposedPorts(imageTag: string): Promise<readonly number[]> {
    const output = await this.#runChecked(
      ["inspect", "--format", "{{json .Config.ExposedPorts}}", assertImageReference(imageTag)],
      "inspect exposed ports",
    );
    return parseExposedPorts(output);
  }

  /**
   * Downloads a public image when the host does not have it yet.
   *
   * @param imageTag - Image reference, such as "postgres:18.6-alpine".
   * @throws {InvalidDockerArgumentError} When the reference is malformed.
   * @throws {DockerCommandError} When docker cannot download it.
   */
  async ensurePulled(imageTag: string): Promise<void> {
    if (await this.exists(imageTag)) {
      return;
    }
    await this.#runChecked(
      ["pull", "--", assertImageReference(imageTag)],
      "pull",
      PULL_TIMEOUT_IN_MS,
    );
  }

  /**
   * Removes the tag of an unlabelled Railpack image once the labelled image exists; the layers
   * stay, shared with the labelled image.
   *
   * @param imageTag - Reference such as "nelcota/api:0a1b2c3d4e5f-railpack".
   * @throws {UnmanagedResourceError} When the reference is not a Railpack image of the platform.
   * @throws {DockerCommandError} When docker cannot remove the tag.
   */
  async removeRailpackBase(imageTag: string): Promise<void> {
    if (isRailpackBaseTag(imageTag) === false) {
      throw new UnmanagedResourceError(`image ${imageTag}`);
    }
    await this.#runChecked(["rm", "--no-prune", "--", imageTag], "rm");
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
