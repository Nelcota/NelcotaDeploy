import { and, count, desc, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";

import { type Actor, recordAuditEvent } from "@/audit";
import { type Database, tables, type Transaction } from "@/db";
import { cancelQueuedJobs, enqueueJob } from "@/jobs";
import { getProject } from "@/projects";

import {
  assertDeploymentTransition,
  type DeploymentStatus,
  isTerminalStatus,
} from "./deployment-status";
import {
  DeploymentNotFoundError,
  ProjectNotApprovedError,
  RollbackUnavailableError,
} from "./deployment.errors";

export type DeploymentTrigger = (typeof tables.deployments.$inferSelect)["trigger"];

/** Total runs of a deploy job; the second only happens when a worker crashed mid-deploy. */
const DEPLOY_MAX_ATTEMPTS = 2;
const MAX_PAGE_SIZE = 100;
const MAX_ROLLBACK_CANDIDATES = 10;
const IN_PROGRESS_STATUSES: DeploymentStatus[] = [
  "cloning",
  "building",
  "starting",
  "health_checking",
];

/** Input for {@link requestDeployment}. */
export type DeploymentRequest = {
  readonly projectId: string;
  readonly trigger: DeploymentTrigger;
  readonly actor: Actor;
  readonly triggeredByUserId: string | null;
  /** Exact commit to build; the branch head when null. */
  readonly commitSha?: string | null;
  readonly commitMessage?: string | null;
  /** Deployment whose image is reused instead of building (redeploy and rollback). */
  readonly sourceDeploymentId?: string | null;
};

const deploymentColumns = {
  id: tables.deployments.id,
  projectId: tables.deployments.projectId,
  projectName: tables.projects.name,
  projectSlug: tables.projects.slug,
  status: tables.deployments.status,
  trigger: tables.deployments.trigger,
  triggeredByLabel: tables.deployments.triggeredByLabel,
  branch: tables.deployments.branch,
  requestedCommitSha: tables.deployments.requestedCommitSha,
  commitSha: tables.deployments.commitSha,
  commitMessage: tables.deployments.commitMessage,
  imageTag: tables.deployments.imageTag,
  containerName: tables.deployments.containerName,
  sourceDeploymentId: tables.deployments.sourceDeploymentId,
  errorMessage: tables.deployments.errorMessage,
  cancelRequestedAt: tables.deployments.cancelRequestedAt,
  createdAt: tables.deployments.createdAt,
  startedAt: tables.deployments.startedAt,
  finishedAt: tables.deployments.finishedAt,
  // Every query with these columns joins the project, so its current deployment is at hand.
  isLive: sql<boolean>`${tables.projects.currentDeploymentId} = ${tables.deployments.id}`.mapWith(
    (value: unknown) => value === 1 || value === true,
  ),
};

/** A deployment with its project name. */
export type Deployment = {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly projectSlug: string;
  /** Whether this is the deployment the project serves right now. */
  readonly isLive: boolean;
  readonly status: DeploymentStatus;
  readonly trigger: DeploymentTrigger;
  readonly triggeredByLabel: string;
  readonly branch: string;
  readonly requestedCommitSha: string | null;
  readonly commitSha: string | null;
  readonly commitMessage: string | null;
  readonly imageTag: string | null;
  readonly containerName: string | null;
  readonly sourceDeploymentId: string | null;
  readonly errorMessage: string | null;
  readonly cancelRequestedAt: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
};

function findReusableImage(
  transaction: Transaction,
  projectId: string,
  sourceDeploymentId: string,
) {
  const source = transaction
    .select({
      imageTag: tables.deployments.imageTag,
      status: tables.deployments.status,
      commitSha: tables.deployments.commitSha,
      commitMessage: tables.deployments.commitMessage,
      branch: tables.deployments.branch,
    })
    .from(tables.deployments)
    .where(
      and(
        eq(tables.deployments.id, sourceDeploymentId),
        eq(tables.deployments.projectId, projectId),
      ),
    )
    .get();
  if (source == null) {
    throw new RollbackUnavailableError("the source deployment does not belong to this project");
  }
  if (source.status !== "succeeded" || source.imageTag == null) {
    throw new RollbackUnavailableError("the source deployment has no successful image");
  }
  return source;
}

/**
 * Creates a deployment and queues it for the worker.
 *
 * @remarks
 * Requests are idempotent: an identical request still waiting in the queue is returned
 * instead of creating another one, and older queued deployments of the project are
 * cancelled because the new one supersedes them. The running deployment, if any, is
 * left alone; the queue starts the new one after it.
 *
 * @param database - Database.
 * @param request - What to deploy and who asked.
 * @returns The deployment id and whether it was created (false for a duplicate request).
 * @throws {ProjectNotFoundError} When the project does not exist.
 * @throws {ProjectNotApprovedError} When an admin has not approved the project.
 * @throws {RollbackUnavailableError} When the source deployment has no reusable image.
 */
export function requestDeployment(
  database: Database,
  request: DeploymentRequest,
): { deploymentId: string; created: boolean } {
  return database.transaction((transaction) => {
    const project = getProject(transaction, request.projectId);
    if (project.deploymentsApproved === false) {
      throw new ProjectNotApprovedError(project.id);
    }
    const sourceDeploymentId = request.sourceDeploymentId ?? null;
    const source =
      sourceDeploymentId == null
        ? null
        : findReusableImage(transaction, project.id, sourceDeploymentId);
    const requestedCommitSha = request.commitSha ?? null;

    const pending = transaction
      .select({
        id: tables.deployments.id,
        status: tables.deployments.status,
        requestedCommitSha: tables.deployments.requestedCommitSha,
        sourceDeploymentId: tables.deployments.sourceDeploymentId,
      })
      .from(tables.deployments)
      .where(
        and(
          eq(tables.deployments.projectId, project.id),
          inArray(tables.deployments.status, ["queued", ...IN_PROGRESS_STATUSES]),
        ),
      )
      .all();
    const duplicate = pending.find(
      (deployment) =>
        deployment.sourceDeploymentId === sourceDeploymentId &&
        deployment.requestedCommitSha === requestedCommitSha &&
        // A branch-head request may run again once the earlier one started: the head may have moved.
        (deployment.status === "queued" || requestedCommitSha != null),
    );
    if (duplicate != null) {
      return { deploymentId: duplicate.id, created: false };
    }

    const now = new Date();
    const superseded = pending
      .filter((deployment) => deployment.status === "queued")
      .map((deployment) => deployment.id);
    if (superseded.length > 0) {
      transaction
        .update(tables.deployments)
        .set({
          status: "cancelled",
          errorMessage: "Superseded by a newer deployment",
          finishedAt: now.toISOString(),
        })
        .where(inArray(tables.deployments.id, superseded))
        .run();
      const supersededJobs = transaction
        .select({ id: tables.jobs.id })
        .from(tables.jobs)
        .where(inArray(tables.jobs.deploymentId, superseded))
        .all()
        .map((job) => job.id);
      cancelQueuedJobs(transaction, supersededJobs, now);
    }

    const deploymentId = Bun.randomUUIDv7();
    transaction
      .insert(tables.deployments)
      .values({
        id: deploymentId,
        projectId: project.id,
        status: "queued",
        trigger: request.trigger,
        triggeredByUserId: request.triggeredByUserId,
        triggeredByLabel: request.actor.label,
        branch: source?.branch ?? project.branch,
        requestedCommitSha,
        commitSha: source?.commitSha ?? null,
        commitMessage: source?.commitMessage ?? request.commitMessage ?? null,
        imageTag: source?.imageTag ?? null,
        sourceDeploymentId,
        createdAt: now.toISOString(),
      })
      .run();
    enqueueJob(
      transaction,
      { kind: "deploy", projectId: project.id, deploymentId, maxAttempts: DEPLOY_MAX_ATTEMPTS },
      now,
    );
    recordAuditEvent(transaction, {
      actor: request.actor,
      action: `deployment.${request.trigger}`,
      targetType: "deployment",
      targetId: deploymentId,
      metadata: { projectId: project.id, commitSha: requestedCommitSha, sourceDeploymentId },
    });
    return { deploymentId, created: true };
  });
}

/**
 * Cancels a deployment. Queued deployments stop immediately; running ones stop at the
 * worker's next checkpoint.
 *
 * @param database - Database.
 * @param deploymentId - Deployment to cancel.
 * @param actor - Who cancels it.
 * @returns The status after the request: "cancelled", "cancelling" or the terminal status.
 * @throws {DeploymentNotFoundError} When the deployment does not exist.
 */
export function cancelDeployment(
  database: Database,
  deploymentId: string,
  actor: Actor,
): "cancelled" | "cancelling" | DeploymentStatus {
  return database.transaction((transaction) => {
    const deployment = transaction
      .select({ status: tables.deployments.status, projectId: tables.deployments.projectId })
      .from(tables.deployments)
      .where(eq(tables.deployments.id, deploymentId))
      .get();
    if (deployment == null) {
      throw new DeploymentNotFoundError(deploymentId);
    }
    if (isTerminalStatus(deployment.status)) {
      return deployment.status;
    }
    const now = new Date().toISOString();
    recordAuditEvent(transaction, {
      actor,
      action: "deployment.cancel",
      targetType: "deployment",
      targetId: deploymentId,
      metadata: { projectId: deployment.projectId },
    });
    if (deployment.status === "queued") {
      transaction
        .update(tables.deployments)
        .set({ status: "cancelled", errorMessage: "Cancelled before it started", finishedAt: now })
        .where(eq(tables.deployments.id, deploymentId))
        .run();
      const jobIds = transaction
        .select({ id: tables.jobs.id })
        .from(tables.jobs)
        .where(eq(tables.jobs.deploymentId, deploymentId))
        .all()
        .map((job) => job.id);
      cancelQueuedJobs(transaction, jobIds);
      return "cancelled";
    }
    transaction
      .update(tables.deployments)
      .set({ cancelRequestedAt: now })
      .where(eq(tables.deployments.id, deploymentId))
      .run();
    return "cancelling";
  });
}

/**
 * Reads a deployment.
 *
 * @param database - Database.
 * @param deploymentId - Deployment id.
 * @returns The deployment.
 * @throws {DeploymentNotFoundError} When it does not exist.
 */
export function getDeployment(database: Database, deploymentId: string): Deployment {
  const deployment = database
    .select(deploymentColumns)
    .from(tables.deployments)
    .innerJoin(tables.projects, eq(tables.projects.id, tables.deployments.projectId))
    .where(eq(tables.deployments.id, deploymentId))
    .get();
  if (deployment == null) {
    throw new DeploymentNotFoundError(deploymentId);
  }
  return deployment;
}

/**
 * Lists deployments, newest first, with cursor pagination.
 *
 * @param database - Database.
 * @param options - Optional project and status filters; `before` is the createdAt of the
 * last row already shown.
 * @returns Up to `limit` deployments (at most 100).
 */
export function listDeployments(
  database: Database,
  options: {
    readonly projectId?: string | undefined;
    readonly status?: DeploymentStatus | undefined;
    readonly limit: number;
    readonly before?: string | undefined;
  },
): Deployment[] {
  const limit = Math.min(Math.max(Math.trunc(options.limit), 1), MAX_PAGE_SIZE);
  return database
    .select(deploymentColumns)
    .from(tables.deployments)
    .innerJoin(tables.projects, eq(tables.projects.id, tables.deployments.projectId))
    .where(
      and(
        options.projectId == null ? undefined : eq(tables.deployments.projectId, options.projectId),
        options.status == null ? undefined : eq(tables.deployments.status, options.status),
        options.before == null ? undefined : lt(tables.deployments.createdAt, options.before),
      ),
    )
    .orderBy(desc(tables.deployments.createdAt), desc(tables.deployments.id))
    .limit(limit)
    .all();
}

/**
 * Lists earlier successful deployments whose image a rollback could reuse.
 *
 * @param database - Database.
 * @param projectId - Project id.
 * @returns Up to 10 deployments, newest first, excluding the current one.
 */
export function listRollbackCandidates(database: Database, projectId: string): Deployment[] {
  const project = getProject(database, projectId);
  return database
    .select(deploymentColumns)
    .from(tables.deployments)
    .innerJoin(tables.projects, eq(tables.projects.id, tables.deployments.projectId))
    .where(
      and(
        eq(tables.deployments.projectId, projectId),
        eq(tables.deployments.status, "succeeded"),
        isNotNull(tables.deployments.imageTag),
        project.currentDeploymentId == null
          ? undefined
          : ne(tables.deployments.id, project.currentDeploymentId),
      ),
    )
    .orderBy(desc(tables.deployments.createdAt))
    .limit(MAX_ROLLBACK_CANDIDATES)
    .all();
}

/** Fields the worker records while a deployment progresses. */
export type DeploymentProgress = {
  readonly commitSha?: string;
  readonly commitMessage?: string;
  readonly imageTag?: string;
  readonly containerName?: string;
  readonly errorMessage?: string | null;
};

/**
 * Moves a deployment to its next status, enforcing the lifecycle.
 *
 * @param database - Database or open transaction.
 * @param deploymentId - Deployment id.
 * @param to - Next status.
 * @param progress - Fields learned in this step.
 * @throws {DeploymentNotFoundError} When the deployment does not exist.
 * @throws {InvalidDeploymentTransitionError} When the change breaks the lifecycle.
 */
export function transitionDeployment(
  database: Database | Transaction,
  deploymentId: string,
  to: DeploymentStatus,
  progress: DeploymentProgress = {},
): void {
  const current = database
    .select({ status: tables.deployments.status, startedAt: tables.deployments.startedAt })
    .from(tables.deployments)
    .where(eq(tables.deployments.id, deploymentId))
    .get();
  if (current == null) {
    throw new DeploymentNotFoundError(deploymentId);
  }
  assertDeploymentTransition(current.status, to);
  const now = new Date().toISOString();
  database
    .update(tables.deployments)
    .set({
      ...progress,
      status: to,
      startedAt: current.startedAt ?? (to === "queued" ? null : now),
      finishedAt: isTerminalStatus(to) ? now : null,
    })
    .where(eq(tables.deployments.id, deploymentId))
    .run();
}

/**
 * Marks a deployment as succeeded and makes it the project's current deployment.
 *
 * @param database - Database.
 * @param deploymentId - Deployment id.
 * @throws {InvalidDeploymentTransitionError} When it is not health checking.
 */
export function completeDeployment(database: Database, deploymentId: string): void {
  database.transaction((transaction) => {
    transitionDeployment(transaction, deploymentId, "succeeded", { errorMessage: null });
    const deployment = transaction
      .select({ projectId: tables.deployments.projectId })
      .from(tables.deployments)
      .where(eq(tables.deployments.id, deploymentId))
      .get();
    if (deployment == null) {
      throw new DeploymentNotFoundError(deploymentId);
    }
    transaction
      .update(tables.projects)
      .set({ currentDeploymentId: deploymentId })
      .where(eq(tables.projects.id, deployment.projectId))
      .run();
  });
}

/**
 * Tells whether someone asked to cancel a running deployment.
 *
 * @param database - Database.
 * @param deploymentId - Deployment id.
 * @returns True when cancellation was requested.
 */
export function isCancellationRequested(database: Database, deploymentId: string): boolean {
  const row = database
    .select({ cancelRequestedAt: tables.deployments.cancelRequestedAt })
    .from(tables.deployments)
    .where(eq(tables.deployments.id, deploymentId))
    .get();
  return row?.cancelRequestedAt != null;
}

/**
 * Counts deployments waiting in the queue or running right now.
 *
 * @param database - Database.
 * @returns Number of unfinished deployments.
 */
export function countActiveDeployments(database: Database): number {
  const row = database
    .select({ total: count() })
    .from(tables.deployments)
    .where(inArray(tables.deployments.status, ["queued", ...IN_PROGRESS_STATUSES]))
    .get();
  return row?.total ?? 0;
}
