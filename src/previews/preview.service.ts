import { and, count, desc, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";

import { type Database, tables, type Transaction } from "@/db";
import { CLEANUP_MAX_ATTEMPTS, enqueueJob } from "@/jobs";
import { assertHostnameOwnership, getSystemSettings } from "@/settings";

import { PreviewLimitError } from "./preview.errors";

/** Most previews a project runs at once, so pull requests cannot exhaust the server. */
export const MAX_ACTIVE_PREVIEWS = 5;

const previewColumns = {
  id: tables.previews.id,
  projectId: tables.previews.projectId,
  pullRequestNumber: tables.previews.pullRequestNumber,
  branch: tables.previews.branch,
  headSha: tables.previews.headSha,
  status: tables.previews.status,
  currentDeploymentId: tables.previews.currentDeploymentId,
  createdAt: tables.previews.createdAt,
};

/** A pull request preview. */
export type Preview = {
  readonly id: string;
  readonly projectId: string;
  readonly pullRequestNumber: number;
  readonly branch: string;
  /** Latest commit of the pull request. */
  readonly headSha: string;
  readonly status: "active" | "closed";
  /** Deployment serving the preview; null until the first one succeeds. */
  readonly currentDeploymentId: string | null;
  readonly createdAt: string;
};

function findPreview(
  database: Database | Transaction,
  projectId: string,
  pullRequestNumber: number,
): Preview | undefined {
  return database
    .select(previewColumns)
    .from(tables.previews)
    .where(
      and(
        eq(tables.previews.projectId, projectId),
        eq(tables.previews.pullRequestNumber, pullRequestNumber),
      ),
    )
    .get();
}

function countActive(transaction: Transaction, projectId: string): number {
  const row = transaction
    .select({ total: count() })
    .from(tables.previews)
    .where(and(eq(tables.previews.projectId, projectId), eq(tables.previews.status, "active")))
    .get();
  return row?.total ?? 0;
}

function cancelQueuedPreviewDeployments(
  database: Transaction,
  target: { readonly projectId: string; readonly previewId: string },
  timestamp: string,
): void {
  const preview = eq(tables.deployments.previewId, target.previewId);
  const projectJobs = eq(tables.jobs.projectId, target.projectId);
  const runningDeploymentId = database
    .select({ deploymentId: tables.jobs.deploymentId })
    .from(tables.jobs)
    .where(and(projectJobs, eq(tables.jobs.status, "running"), eq(tables.jobs.kind, "deploy")))
    .get()?.deploymentId;
  database
    .update(tables.deployments)
    .set({
      status: "cancelled",
      errorMessage: "Preview closed before deployment started",
      finishedAt: timestamp,
    })
    .where(
      and(
        preview,
        eq(tables.deployments.status, "queued"),
        runningDeploymentId == null ? undefined : ne(tables.deployments.id, runningDeploymentId),
      ),
    )
    .run();
  const cancelled = database
    .select({ id: tables.deployments.id })
    .from(tables.deployments)
    .where(and(preview, eq(tables.deployments.status, "cancelled")));
  database
    .update(tables.jobs)
    .set({ status: "cancelled", finishedAt: timestamp })
    .where(
      and(
        projectJobs,
        eq(tables.jobs.kind, "deploy"),
        eq(tables.jobs.status, "queued"),
        inArray(tables.jobs.deploymentId, cancelled),
      ),
    )
    .run();
}

function cancelPreviewDeployments(
  database: Transaction,
  target: { readonly projectId: string; readonly previewId: string },
  now: Date,
): void {
  const timestamp = now.toISOString();
  cancelQueuedPreviewDeployments(database, target, timestamp);

  database
    .update(tables.deployments)
    .set({ cancelRequestedAt: timestamp })
    .where(
      and(
        eq(tables.deployments.previewId, target.previewId),
        isNull(tables.deployments.cancelRequestedAt),
        notInArray(tables.deployments.status, ["succeeded", "failed", "cancelled"]),
      ),
    )
    .run();
}

function queuePreviewCleanup(
  database: Database | Transaction,
  target: { readonly projectId: string; readonly previewId: string },
  now: Date,
): void {
  enqueueJob(
    database,
    {
      kind: "preview_cleanup",
      maxAttempts: CLEANUP_MAX_ATTEMPTS,
      projectId: target.projectId,
      payload: { previewId: target.previewId },
      // A preview can close again while the previous cleanup is still running.
      dedupeKey: `preview-cleanup:${target.previewId}:${Bun.randomUUIDv7()}`,
    },
    now,
  );
}

/**
 * Creates the preview of a pull request, or brings an existing one up to its latest commit,
 * reopening it when the pull request was reopened.
 *
 * @param database - Database.
 * @param pullRequest - Project, pull request number, branch and latest commit.
 * @returns The preview id.
 * @throws {PreviewLimitError} When a new preview would exceed 5 active ones.
 */
export function openPreview(
  database: Database,
  pullRequest: {
    readonly projectId: string;
    readonly number: number;
    readonly branch: string;
    readonly headSha: string;
  },
): string {
  return database.transaction(
    (transaction) => {
      const now = new Date().toISOString();
      const existing = findPreview(transaction, pullRequest.projectId, pullRequest.number);
      const wasActive = existing?.status === "active";
      if (
        wasActive === false &&
        countActive(transaction, pullRequest.projectId) >= MAX_ACTIVE_PREVIEWS
      ) {
        throw new PreviewLimitError(pullRequest.projectId, MAX_ACTIVE_PREVIEWS);
      }
      const fields = {
        branch: pullRequest.branch,
        headSha: pullRequest.headSha,
        status: "active" as const,
        updatedAt: now,
        closedAt: null,
      };
      if (existing != null) {
        if (existing.headSha !== pullRequest.headSha) {
          cancelOutdatedPreviewDeployments(transaction, {
            previewId: existing.id,
            headSha: pullRequest.headSha,
            timestamp: now,
          });
        }

        transaction
          .update(tables.previews)
          .set(fields)
          .where(eq(tables.previews.id, existing.id))
          .run();
        assertHostnameOwnership(transaction, getSystemSettings(transaction));
        return existing.id;
      }
      const id = Bun.randomUUIDv7();
      transaction
        .insert(tables.previews)
        .values({
          id,
          projectId: pullRequest.projectId,
          pullRequestNumber: pullRequest.number,
          createdAt: now,
          ...fields,
        })
        .run();
      assertHostnameOwnership(transaction, getSystemSettings(transaction));
      return id;
    },
    { behavior: "immediate" },
  );
}

function cancelOutdatedPreviewDeployments(
  database: Transaction,
  target: { readonly previewId: string; readonly headSha: string; readonly timestamp: string },
): void {
  database
    .update(tables.deployments)
    .set({ cancelRequestedAt: target.timestamp })
    .where(
      and(
        eq(tables.deployments.previewId, target.previewId),
        eq(tables.deployments.trigger, "webhook"),
        ne(tables.deployments.requestedCommitSha, target.headSha),
        isNull(tables.deployments.cancelRequestedAt),
        notInArray(tables.deployments.status, ["succeeded", "failed", "cancelled"]),
      ),
    )
    .run();
}

/**
 * Closes the preview of a pull request and queues the removal of its routes, containers and
 * images from the server.
 *
 * @param database - Database.
 * @param pullRequest - Project and pull request number.
 * @returns The closed preview id, or null when the pull request had no active preview.
 */
export function closePreview(
  database: Database,
  pullRequest: { readonly projectId: string; readonly number: number },
): string | null {
  return database.transaction(
    (transaction) => {
      const preview = findPreview(transaction, pullRequest.projectId, pullRequest.number);
      if (preview?.status !== "active") {
        return null;
      }
      const now = new Date();
      transaction
        .update(tables.previews)
        .set({ status: "closed", closedAt: now.toISOString(), updatedAt: now.toISOString() })
        .where(eq(tables.previews.id, preview.id))
        .run();
      const target = { projectId: preview.projectId, previewId: preview.id };
      cancelPreviewDeployments(transaction, target, now);
      queuePreviewCleanup(transaction, target, now);
      return preview.id;
    },
    { behavior: "immediate" },
  );
}

/**
 * Closes every active preview of a project and queues cleanup jobs for their resources.
 *
 * @param database - Open transaction.
 * @param projectId - Project id.
 */
export function closeProjectPreviews(database: Transaction, projectId: string): void {
  const now = new Date();
  const nowIso = now.toISOString();
  const closed = database
    .update(tables.previews)
    .set({ status: "closed", closedAt: nowIso, updatedAt: nowIso })
    .where(and(eq(tables.previews.projectId, projectId), eq(tables.previews.status, "active")))
    .returning({ id: tables.previews.id })
    .all();
  for (const preview of closed) {
    const target = { projectId, previewId: preview.id };
    cancelPreviewDeployments(database, target, now);
    queuePreviewCleanup(database, target, now);
  }
}

/**
 * Returns a preview.
 *
 * @param database - Database.
 * @param previewId - Preview id.
 * @returns The preview, or null when it does not exist.
 */
export function getPreview(database: Database | Transaction, previewId: string): Preview | null {
  return (
    database
      .select(previewColumns)
      .from(tables.previews)
      .where(eq(tables.previews.id, previewId))
      .get() ?? null
  );
}

/**
 * Lists the active previews of a project, newest first.
 *
 * @param database - Database.
 * @param projectId - Project id.
 * @returns The active previews.
 */
export function listActivePreviews(database: Database, projectId: string): Preview[] {
  return database
    .select(previewColumns)
    .from(tables.previews)
    .where(and(eq(tables.previews.projectId, projectId), eq(tables.previews.status, "active")))
    .orderBy(desc(tables.previews.pullRequestNumber))
    .all();
}
