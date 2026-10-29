import { type CommandRunner, failureReason, type ProcessResult } from "@/process";

import { assertContainerReference, LABELS, labelArgs } from "./docker.commands";
import { DockerCommandError, UnmanagedResourceError } from "./docker.errors";

const COMMAND_TIMEOUT_IN_MS = 30_000;

/**
 * The platform's named volumes on one host. Only volumes carrying the platform label are ever
 * removed, so data created by anything else on the host is never touched.
 */
export class DockerVolumes {
  readonly #binary: string;
  readonly #runner: CommandRunner;

  /**
   * Reaches the volumes of one host.
   *
   * @param binary - Docker CLI executable on the host the runner reaches.
   * @param runner - Where commands run.
   */
  constructor(binary: string, runner: CommandRunner) {
    this.#binary = binary;
    this.#runner = runner;
  }

  async #run(args: readonly string[]): Promise<ProcessResult> {
    return await this.#runner([this.#binary, "volume", ...args], {
      timeoutInMs: COMMAND_TIMEOUT_IN_MS,
    });
  }

  async #runChecked(args: readonly string[], description: string): Promise<string> {
    const result = await this.#run(args);
    if (result.exitCode !== 0) {
      throw new DockerCommandError(
        `docker volume ${description} failed: ${failureReason(result)}`,
        result.exitCode,
      );
    }
    return result.stdout;
  }

  /**
   * Creates a project's volume when it does not exist yet.
   *
   * @param name - Volume name, from `volumeNameFor`.
   * @param projectId - Owning project.
   * @throws {InvalidDockerArgumentError} When the name is malformed.
   * @throws {DockerCommandError} When docker cannot create it.
   */
  async ensure(name: string, projectId: string): Promise<void> {
    const reference = assertContainerReference(name);
    const inspect = await this.#run(["inspect", "--format", "{{.Name}}", "--", reference]);
    if (inspect.exitCode === 0) {
      return;
    }
    const labels = labelArgs({ [LABELS.managed]: "true", [LABELS.projectId]: projectId });
    await this.#runChecked(["create", ...labels, "--", reference], "create");
  }

  /**
   * Deletes a platform volume and its data. Docker refuses while a container uses it.
   *
   * @param name - Volume name.
   * @throws {UnmanagedResourceError} When the volume is not managed by the platform.
   * @throws {DockerCommandError} When docker cannot remove it, for example while in use.
   */
  async remove(name: string): Promise<void> {
    const reference = assertContainerReference(name);
    const format = `{{index .Labels "${LABELS.managed}"}}`;
    const managed = await this.#runChecked(
      ["inspect", "--format", format, "--", reference],
      "inspect",
    );
    if (managed.trim() !== "true") {
      throw new UnmanagedResourceError(`volume ${reference}`);
    }
    await this.#runChecked(["rm", "--", reference], "rm");
  }

  /**
   * Lists the names of a project's volumes.
   *
   * @param projectId - Owning project.
   * @returns Volume names.
   * @throws {DockerCommandError} When docker cannot list them.
   */
  async listForProject(projectId: string): Promise<string[]> {
    const output = await this.#runChecked(
      [
        "ls",
        "--filter",
        `label=${LABELS.managed}=true`,
        "--filter",
        `label=${LABELS.projectId}=${projectId}`,
        "--format",
        "{{.Name}}",
      ],
      "ls",
    );
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  }
}

/** What callers use of {@link DockerVolumes}; tests provide their own. */
export type DockerVolumeStore = { [K in keyof DockerVolumes]: DockerVolumes[K] };
