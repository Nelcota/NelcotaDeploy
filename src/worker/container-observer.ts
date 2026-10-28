import type { Logger } from "pino";

import type { Database } from "@/db";
import { type ContainerInfo, type DockerEngine, LABELS } from "@/docker";
import { resolveEnvironment } from "@/environments";
import { appendRuntimeLogs, getLatestRuntimeLogTime, type RuntimeLogEntry } from "@/logs";
import {
  type ContainerSample,
  recordContainerSamples,
  replaceContainerSnapshots,
} from "@/monitoring";
import { createRedactor, type SecretBox } from "@/secrets";

const FLUSH_INTERVAL_IN_MS = 1000;
const MAX_PENDING_LINES = 5000;
const TIMESTAMPED_LINE = /^(\d{4}-\d{2}-\d{2}T\S+Z) ?(.*)$/;

type Follower = { readonly controller: AbortController; readonly projectId: string };

/**
 * Splits a `docker logs --timestamps` line into its time and message.
 *
 * @param line - Raw line.
 * @param fallback - Time used when the line has no valid timestamp.
 * @returns UTC ISO time (millisecond precision) and message.
 */
export function parseTimestampedLine(
  line: string,
  fallback: Date,
): { createdAt: string; message: string } {
  const match = TIMESTAMPED_LINE.exec(line);
  const timestamp = match?.[1];
  if (timestamp == null) {
    return { createdAt: fallback.toISOString(), message: line };
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return { createdAt: fallback.toISOString(), message: line };
  }
  return { createdAt: date.toISOString(), message: match?.[2] ?? "" };
}

/**
 * Keeps the database view of platform containers current: state snapshots, runtime
 * logs (followed with `docker logs -f`) and resource usage.
 */
export class ContainerObserver implements Disposable {
  readonly #database: Database;
  readonly #docker: DockerEngine;
  readonly #secretBox: SecretBox;
  readonly #logger: Logger;
  readonly #followers = new Map<string, Follower>();
  readonly #flushTimer: ReturnType<typeof setInterval>;
  #pending: RuntimeLogEntry[] = [];
  #running: ContainerInfo[] = [];

  constructor(dependencies: {
    readonly database: Database;
    readonly docker: DockerEngine;
    readonly secretBox: SecretBox;
    readonly logger: Logger;
  }) {
    this.#database = dependencies.database;
    this.#docker = dependencies.docker;
    this.#secretBox = dependencies.secretBox;
    this.#logger = dependencies.logger;
    this.#flushTimer = setInterval(() => this.#flush(), FLUSH_INTERVAL_IN_MS);
  }

  /**
   * Reads every platform container, stores snapshots and follows logs of running ones.
   */
  async refresh(): Promise<void> {
    const containers = await this.#docker.listManagedContainers();
    const observedAt = new Date().toISOString();
    replaceContainerSnapshots(
      this.#database,
      containers
        .filter((container) => container.labels[LABELS.projectId] != null)
        .map((container) => ({
          containerId: container.id,
          projectId: container.labels[LABELS.projectId] ?? "",
          deploymentId: container.labels[LABELS.deploymentId] ?? null,
          name: container.name,
          image: container.image,
          state: container.status,
          health: container.health,
          restartCount: container.restartCount,
          startedAt: container.startedAt,
          observedAt,
        })),
    );
    this.#running = containers.filter((container) => container.running);
    const runningIds = new Set(this.#running.map((container) => container.id));
    for (const [containerId, follower] of this.#followers) {
      if (runningIds.has(containerId) === false) {
        follower.controller.abort();
        this.#followers.delete(containerId);
      }
    }
    await Promise.all(
      this.#running
        .filter((container) => this.#followers.has(container.id) === false)
        .map(async (container) => await this.#follow(container)),
    );
  }

  /**
   * Samples CPU and memory of running platform containers.
   */
  async sampleMetrics(): Promise<void> {
    const byName = new Map(this.#running.map((container) => [container.name, container]));
    if (byName.size === 0) {
      return;
    }
    const stats = await this.#docker.sampleStats([...byName.keys()]);
    const samples: ContainerSample[] = [];
    for (const stat of stats) {
      const projectId = byName.get(stat.name)?.labels[LABELS.projectId];
      if (projectId != null) {
        samples.push({
          projectId,
          cpuPercent: stat.cpuPercent,
          memoryUsedBytes: stat.memoryUsedBytes,
          memoryTotalBytes: stat.memoryLimitBytes,
        });
      }
    }
    recordContainerSamples(this.#database, samples);
  }

  async #follow(container: ContainerInfo): Promise<void> {
    const projectId = container.labels[LABELS.projectId];
    const deploymentId = container.labels[LABELS.deploymentId] ?? null;
    if (projectId == null) {
      return;
    }
    const controller = new AbortController();
    this.#followers.set(container.id, { controller, projectId });
    let redact: (text: string) => string;
    try {
      const environment = await resolveEnvironment(this.#database, this.#secretBox, projectId);
      redact = createRedactor(environment.secretValues);
    } catch (error) {
      // Without the secrets we cannot redact, so the logs are not collected at all.
      this.#logger.warn(
        { err: error, projectId },
        "cannot load secrets for log redaction; skipping logs",
      );
      return;
    }
    const lastStored =
      deploymentId == null ? null : getLatestRuntimeLogTime(this.#database, deploymentId);
    const since = lastStored ?? container.startedAt ?? new Date().toISOString();
    this.#docker
      .followContainerLogs(
        container.id,
        since,
        (line, stream) => {
          const parsed = parseTimestampedLine(line, new Date());
          if (lastStored != null && parsed.createdAt <= lastStored) {
            return;
          }
          if (this.#pending.length >= MAX_PENDING_LINES) {
            return;
          }
          this.#pending.push({
            projectId,
            deploymentId,
            stream,
            message: redact(parsed.message),
            createdAt: parsed.createdAt,
          });
        },
        controller.signal,
      )
      .catch((error: unknown) =>
        this.#logger.warn({ err: error, container: container.name }, "log follower stopped"),
      )
      .finally(() => {
        if (this.#followers.get(container.id)?.controller === controller) {
          this.#followers.delete(container.id);
        }
      });
  }

  #flush(): void {
    if (this.#pending.length === 0) {
      return;
    }
    const entries = this.#pending;
    this.#pending = [];
    try {
      appendRuntimeLogs(this.#database, entries);
    } catch (error) {
      // A project deleted mid-flush violates the foreign key; its lines are dropped.
      this.#logger.warn({ err: error, lines: entries.length }, "could not store runtime logs");
    }
  }

  [Symbol.dispose](): void {
    clearInterval(this.#flushTimer);
    for (const follower of this.#followers.values()) {
      follower.controller.abort();
    }
    this.#followers.clear();
    this.#flush();
  }
}
