import { and, count, desc, eq } from "drizzle-orm";

import { type Database, tables, type Transaction } from "@/db";
import { enqueueJob } from "@/jobs";

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
  return database.transaction((transaction) => {
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
      transaction
        .update(tables.previews)
        .set(fields)
        .where(eq(tables.previews.id, existing.id))
        .run();
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
    return id;
  });
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
  return database.transaction((transaction) => {
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
    enqueueJob(
      transaction,
      {
        kind: "preview_cleanup",
        projectId: pullRequest.projectId,
        payload: { previewId: preview.id },
        dedupeKey: `preview-cleanup:${preview.id}`,
      },
      now,
    );
    return preview.id;
  });
}

/**
 * Returns a preview.
 *
 * @param database - Database.
 * @param previewId - Preview id.
 * @returns The preview, or null when it does not exist.
 */
export function getPreview(database: Database, previewId: string): Preview | null {
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
