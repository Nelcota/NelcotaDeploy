import { z } from "zod";

import { type CommandRunner, failureReason } from "@/process";

import { assertContainerReference, LABELS, PROXY_CONTAINER_NAME } from "../docker.commands";
import {
  DockerCommandError,
  InvalidDockerArgumentError,
  UnmanagedResourceError,
} from "../docker.errors";

const COMMAND_TIMEOUT_IN_MS = 30_000;
const NETWORK_NOT_FOUND = /network .* not found/i;
const PROJECT_NETWORK_PREFIX = "nelcota-project-";

/** Name of the ingress container in the panel Compose stack. */
export const PANEL_PROXY_CONTAINER = "nelcota-ingress";
/** Name of the worker container in the panel Compose stack. */
const PANEL_WORKER_CONTAINER = "nelcota-worker";

const networkSchema = z.object({
  Name: z.string(),
  Labels: z.record(z.string(), z.string()).nullable(),
  Containers: z.record(z.string(), z.object({ Name: z.string() })).nullable(),
});
type Network = z.infer<typeof networkSchema>;

/** Deterministic bridge name for a project. */
export function projectNetworkName(projectId: string): string {
  if (z.uuid().safeParse(projectId).success === false) {
    throw new InvalidDockerArgumentError("Invalid project id for a Docker network");
  }

  return `${PROJECT_NETWORK_PREFIX}${projectId}`;
}

/** Manages the Docker bridges used to isolate project workloads. */
export class DockerNetworks {
  readonly #binary: string;
  readonly #runner: CommandRunner;

  constructor(binary: string, runner: CommandRunner) {
    this.#binary = binary;
    this.#runner = runner;
  }

  async #run(args: readonly string[]) {
    return await this.#runner([this.#binary, "network", ...args], {
      timeoutInMs: COMMAND_TIMEOUT_IN_MS,
    });
  }

  async #inspect(name: string): Promise<Network | null> {
    const result = await this.#run(["inspect", "--", name]);
    if (result.exitCode !== 0) {
      if (NETWORK_NOT_FOUND.test(result.stderr)) {
        return null;
      }

      throw new DockerCommandError(
        `Docker network inspection failed: ${failureReason(result)}`,
        result.exitCode,
      );
    }

    const parsed = z.array(networkSchema).length(1).parse(JSON.parse(result.stdout));
    return parsed[0] ?? null;
  }

  #verify(network: Network, projectId: string): void {
    const labels = network.Labels;
    if (
      network.Name !== projectNetworkName(projectId) ||
      labels?.[LABELS.managed] !== "true" ||
      labels[LABELS.projectNetwork] !== "true" ||
      labels[LABELS.projectId] !== projectId
    ) {
      throw new UnmanagedResourceError(`network ${network.Name} for project ${projectId}`);
    }
  }

  /** Creates a bridge or verifies that an existing bridge belongs to the project. */
  async ensure(projectId: string): Promise<void> {
    const name = projectNetworkName(projectId);
    const existing = await this.#inspect(name);
    if (existing != null) {
      this.#verify(existing, projectId);
      return;
    }

    const result = await this.#run([
      "create",
      "--label",
      `${LABELS.managed}=true`,
      "--label",
      `${LABELS.projectNetwork}=true`,
      "--label",
      `${LABELS.projectId}=${projectId}`,
      "--",
      name,
    ]);
    if (result.exitCode !== 0) {
      // A different worker may have created the same bridge after the first inspection.
      const concurrent = await this.#inspect(name);
      if (concurrent == null) {
        throw new DockerCommandError(
          `Docker network creation failed: ${failureReason(result)}`,
          result.exitCode,
        );
      }

      this.#verify(concurrent, projectId);
    }
  }

  /** Attaches a container to an owned bridge and tolerates an equivalent concurrent attach. */
  async attach(projectId: string, container: string): Promise<void> {
    const name = projectNetworkName(projectId);
    const network = await this.#inspect(name);
    if (network == null) {
      throw new Error(`Project network ${name} is missing`);
    }

    this.#verify(network, projectId);
    if (Object.values(network.Containers ?? {}).some((entry) => entry.Name === container)) {
      return;
    }

    const result = await this.#run(["connect", "--", name, assertContainerReference(container)]);
    if (result.exitCode !== 0) {
      const latest = await this.#inspect(name);
      if (
        latest == null ||
        Object.values(latest.Containers ?? {}).some((entry) => entry.Name === container) === false
      ) {
        throw new DockerCommandError(
          `Docker network connection failed: ${failureReason(result)}`,
          result.exitCode,
        );
      }

      this.#verify(latest, projectId);
    }
  }

  /** Lists managed project bridges so a replacement proxy or worker can rejoin them. */
  async projects(): Promise<string[]> {
    const result = await this.#run([
      "ls",
      "--filter",
      `label=${LABELS.managed}=true`,
      "--filter",
      `label=${LABELS.projectNetwork}=true`,
      "--format",
      `{{.Label "${LABELS.projectId}"}}`,
    ]);
    if (result.exitCode !== 0) {
      throw new DockerCommandError(
        `Docker network list failed: ${failureReason(result)}`,
        result.exitCode,
      );
    }

    return result.stdout.split(/\s+/).filter((value) => z.uuid().safeParse(value).success);
  }

  /** Removes an empty project bridge after disconnecting the platform's trusted containers. */
  async remove(projectId: string): Promise<void> {
    const name = projectNetworkName(projectId);
    const network = await this.#inspect(name);
    if (network == null) {
      return;
    }

    this.#verify(network, projectId);
    const names = Object.values(network.Containers ?? {}).map((entry) => entry.Name);
    const peers = new Set([PANEL_PROXY_CONTAINER, PANEL_WORKER_CONTAINER, PROXY_CONTAINER_NAME]);
    if (names.some((container) => peers.has(container) === false)) {
      throw new Error(`Project network ${name} still has attached workloads`);
    }

    for (const container of names) {
      const result = await this.#run(["disconnect", "--", name, container]);
      if (result.exitCode !== 0) {
        throw new DockerCommandError(
          `Docker network disconnection failed: ${failureReason(result)}`,
          result.exitCode,
        );
      }
    }

    const result = await this.#run(["rm", "--", name]);
    if (result.exitCode !== 0 && NETWORK_NOT_FOUND.test(result.stderr) === false) {
      throw new DockerCommandError(
        `Docker network removal failed: ${failureReason(result)}`,
        result.exitCode,
      );
    }
  }
}

export type DockerNetworkStore = Pick<DockerNetworks, keyof DockerNetworks>;
