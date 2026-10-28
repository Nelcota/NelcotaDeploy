import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";

import { type Database, tables } from "@/db";
import type { LogLevel } from "@/shared/log-level";

const MAX_LINE_LENGTH = 8192;
const MAX_PAGE_SIZE = 1000;

/** Line written while building and starting a deployment. */
export type DeploymentLogEntry = {
  readonly stream: "system" | "stdout" | "stderr";
  readonly level: LogLevel;
  readonly message: string;
};

/** Line a running container wrote. */
export type RuntimeLogEntry = {
  readonly projectId: string;
  readonly deploymentId: string | null;
  readonly stream: "stdout" | "stderr";
  readonly message: string;
  /** UTC ISO time docker reported for the line. */
  readonly createdAt: string;
};

function truncateLine(message: string): string {
  return message.length > MAX_LINE_LENGTH ? `${message.slice(0, MAX_LINE_LENGTH)}…` : message;
}

function clampLimit(limit: number): number {
  if (Number.isFinite(limit) === false) {
    return MAX_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_SIZE);
}

/**
 * Appends deployment log lines in one transaction.
 *
 * @param database - Database.
 * @param deploymentId - Deployment the lines belong to.
 * @param entries - Lines, already redacted.
 */
export function appendDeploymentLogs(
  database: Database,
  deploymentId: string,
  entries: readonly DeploymentLogEntry[],
): void {
  if (entries.length === 0) {
    return;
  }
  const createdAt = new Date().toISOString();
  database
    .insert(tables.deploymentLogs)
    .values(
      entries.map((entry) => ({
        deploymentId,
        stream: entry.stream,
        level: entry.level,
        message: truncateLine(entry.message),
        createdAt,
      })),
    )
    .run();
}

/**
 * Lists deployment log lines after a cursor, oldest first.
 *
 * @param database - Database.
 * @param deploymentId - Deployment id.
 * @param options - `afterId` is the last line id already received.
 * @returns Up to `limit` lines (at most 1000).
 */
export function listDeploymentLogs(
  database: Database,
  deploymentId: string,
  options: { readonly afterId: number; readonly limit: number },
) {
  return database
    .select({
      id: tables.deploymentLogs.id,
      stream: tables.deploymentLogs.stream,
      level: tables.deploymentLogs.level,
      message: tables.deploymentLogs.message,
      createdAt: tables.deploymentLogs.createdAt,
    })
    .from(tables.deploymentLogs)
    .where(
      and(
        eq(tables.deploymentLogs.deploymentId, deploymentId),
        gt(tables.deploymentLogs.id, options.afterId),
      ),
    )
    .orderBy(asc(tables.deploymentLogs.id))
    .limit(clampLimit(options.limit))
    .all();
}

/**
 * Appends runtime log lines in one transaction.
 *
 * @param database - Database.
 * @param entries - Lines, already redacted.
 */
export function appendRuntimeLogs(database: Database, entries: readonly RuntimeLogEntry[]): void {
  if (entries.length === 0) {
    return;
  }
  database
    .insert(tables.runtimeLogs)
    .values(entries.map((entry) => ({ ...entry, message: truncateLine(entry.message) })))
    .run();
}

/**
 * Lists runtime log lines of a project.
 *
 * @param database - Database.
 * @param projectId - Project id.
 * @param options - With `afterId`, lines after that cursor; otherwise the last `limit` lines.
 * @returns Lines, oldest first.
 */
export function listRuntimeLogs(
  database: Database,
  projectId: string,
  options: {
    readonly afterId?: number | undefined;
    readonly limit: number;
    readonly deploymentId?: string | undefined;
  },
) {
  const columns = {
    id: tables.runtimeLogs.id,
    deploymentId: tables.runtimeLogs.deploymentId,
    stream: tables.runtimeLogs.stream,
    message: tables.runtimeLogs.message,
    createdAt: tables.runtimeLogs.createdAt,
  };
  const deploymentCondition =
    options.deploymentId == null
      ? undefined
      : eq(tables.runtimeLogs.deploymentId, options.deploymentId);
  if (options.afterId != null) {
    return database
      .select(columns)
      .from(tables.runtimeLogs)
      .where(
        and(
          eq(tables.runtimeLogs.projectId, projectId),
          gt(tables.runtimeLogs.id, options.afterId),
          deploymentCondition,
        ),
      )
      .orderBy(asc(tables.runtimeLogs.id))
      .limit(clampLimit(options.limit))
      .all();
  }
  return database
    .select(columns)
    .from(tables.runtimeLogs)
    .where(and(eq(tables.runtimeLogs.projectId, projectId), deploymentCondition))
    .orderBy(desc(tables.runtimeLogs.id))
    .limit(clampLimit(options.limit))
    .all()
    .toReversed();
}

/**
 * Returns the time of the newest stored runtime line of a deployment's container.
 *
 * @param database - Database.
 * @param deploymentId - Deployment id.
 * @returns UTC ISO time, or null when nothing was stored yet.
 */
export function getLatestRuntimeLogTime(database: Database, deploymentId: string): string | null {
  const row = database
    .select({ createdAt: tables.runtimeLogs.createdAt })
    .from(tables.runtimeLogs)
    .where(eq(tables.runtimeLogs.deploymentId, deploymentId))
    .orderBy(desc(tables.runtimeLogs.id))
    .limit(1)
    .get();
  return row?.createdAt ?? null;
}

/**
 * Applies log retention: keeps the newest runtime lines per project and drops deployment
 * logs older than the retention window.
 *
 * @param database - Database.
 * @param options - Retention limits and current time.
 * @returns Number of deleted rows per table.
 */
export function pruneLogs(
  database: Database,
  options: {
    readonly runtimeLinesPerProject: number;
    readonly deploymentLogRetentionDays: number;
    readonly now: Date;
  },
): { runtime: number; deployment: number } {
  const millisecondsPerDay = 86_400_000;
  const cutoff = new Date(
    options.now.getTime() - options.deploymentLogRetentionDays * millisecondsPerDay,
  );
  return database.transaction((transaction) => {
    const runtime = transaction
      .delete(tables.runtimeLogs)
      .where(
        lt(
          tables.runtimeLogs.id,
          sql`(
            SELECT COALESCE(MIN(id), 0) FROM (
              SELECT kept.id FROM runtime_logs AS kept
              WHERE kept.project_id = ${tables.runtimeLogs.projectId}
              ORDER BY kept.id DESC
              LIMIT ${options.runtimeLinesPerProject}
            )
          )`,
        ),
      )
      .returning({ id: tables.runtimeLogs.id })
      .all().length;
    const finishedBeforeCutoff = transaction
      .select({ id: tables.deployments.id })
      .from(tables.deployments)
      .where(lt(tables.deployments.finishedAt, cutoff.toISOString()));
    const deployment = transaction
      .delete(tables.deploymentLogs)
      .where(inArray(tables.deploymentLogs.deploymentId, finishedBeforeCutoff))
      .returning({ id: tables.deploymentLogs.id })
      .all().length;
    return { runtime, deployment };
  });
}
