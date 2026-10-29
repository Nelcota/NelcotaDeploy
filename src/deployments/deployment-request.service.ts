import { and, eq, inArray } from "drizzle-orm";

import { type Actor, recordAuditEvent } from "@/audit";
import { type Database, tables, type Transaction } from "@/db";
import { cancelQueuedJobs, enqueueJob } from "@/jobs";
import { getProject } from "@/projects";

import { ACTIVE_STATUSES, type DeploymentStatus } from "./deployment-status";
import {
  ProjectNotApprovedError,
  RetryUnavailableError,
  RollbackUnavailableError,
} from "./deployment.errors";
import { type DeploymentTrigger, getDeployment } from "./deployment.service";

/** Total runs of a deploy job; the second only happens when a worker crashed mid-deploy. */
const DEPLOY_MAX_ATTEMPTS = 2;

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

type ReusableImage = ReturnType<typeof findReusableImage>;

type PendingDeployment = {
  readonly id: string;
  readonly status: DeploymentStatus;
  readonly requestedCommitSha: string | null;
  readonly sourceDeploymentId: string | null;
  readonly serverId: string;
};

/** What makes two deployment requests identical. */
type RequestIdentity = {
  readonly sourceDeploymentId: string | null;
  readonly requestedCommitSha: string | null;
  /** A request for another server, after a move, is never a duplicate. */
  readonly serverId: string;
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

function listPendingDeployments(transaction: Transaction, projectId: string): PendingDeployment[] {
  return transaction
    .select({
      id: tables.deployments.id,
      status: tables.deployments.status,
      requestedCommitSha: tables.deployments.requestedCommitSha,
      sourceDeploymentId: tables.deployments.sourceDeploymentId,
      serverId: tables.deployments.serverId,
    })
    .from(tables.deployments)
    .where(
      and(
        eq(tables.deployments.projectId, projectId),
        inArray(tables.deployments.status, ACTIVE_STATUSES),
      ),
    )
    .all();
}

/**
 * Finds a pending deployment identical to a new request.
 *
 * @param pending - Queued and running deployments of the project.
 * @param identity - Source deployment and requested commit of the new request.
 * @returns The identical deployment, or undefined when the request is new.
 */
function findDuplicateRequest(
  pending: readonly PendingDeployment[],
  identity: RequestIdentity,
): PendingDeployment | undefined {
  return pending.find(
    (deployment) =>
      deployment.sourceDeploymentId === identity.sourceDeploymentId &&
      deployment.requestedCommitSha === identity.requestedCommitSha &&
      deployment.serverId === identity.serverId &&
      // A branch-head request may run again once the earlier one started: the head may have moved.
      (deployment.status === "queued" || identity.requestedCommitSha != null),
  );
}

function cancelSupersededDeployments(
  transaction: Transaction,
  pending: readonly PendingDeployment[],
  now: Date,
): void {
  const superseded = pending
    .filter((deployment) => deployment.status === "queued")
    .map((deployment) => deployment.id);
  if (superseded.length === 0) {
    return;
  }
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

// A redeploy or rollback inherits the revision and image of its source deployment.
function revisionOf(
  request: DeploymentRequest,
  { branch, source }: { readonly branch: string; readonly source: ReusableImage | null },
) {
  const requestedMessage = request.commitMessage ?? null;
  if (source == null) {
    return { branch, commitSha: null, commitMessage: requestedMessage, imageTag: null };
  }
  return {
    branch: source.branch,
    commitSha: source.commitSha,
    commitMessage: source.commitMessage ?? requestedMessage,
    imageTag: source.imageTag,
  };
}

function insertQueuedDeployment(
  transaction: Transaction,
  request: DeploymentRequest,
  {
    branch,
    serverId,
    source,
    now,
  }: {
    readonly branch: string;
    /** Server the project is placed on now, where this deployment will run. */
    readonly serverId: string;
    readonly source: ReusableImage | null;
    readonly now: Date;
  },
): string {
  const deploymentId = Bun.randomUUIDv7();
  transaction
    .insert(tables.deployments)
    .values({
      id: deploymentId,
      projectId: request.projectId,
      status: "queued",
      trigger: request.trigger,
      triggeredByUserId: request.triggeredByUserId,
      triggeredByLabel: request.actor.label,
      ...revisionOf(request, { branch, source }),
      requestedCommitSha: request.commitSha ?? null,
      sourceDeploymentId: request.sourceDeploymentId ?? null,
      serverId,
      createdAt: now.toISOString(),
    })
    .run();
  return deploymentId;
}

function queueDeployment(
  transaction: Transaction,
  request: DeploymentRequest,
  { deploymentId, now }: { readonly deploymentId: string; readonly now: Date },
): void {
  enqueueJob(
    transaction,
    {
      kind: "deploy",
      projectId: request.projectId,
      deploymentId,
      maxAttempts: DEPLOY_MAX_ATTEMPTS,
    },
    now,
  );
  recordAuditEvent(transaction, {
    actor: request.actor,
    action: `deployment.${request.trigger}`,
    targetType: "deployment",
    targetId: deploymentId,
    metadata: {
      projectId: request.projectId,
      commitSha: request.commitSha ?? null,
      sourceDeploymentId: request.sourceDeploymentId ?? null,
    },
  });
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

    const pending = listPendingDeployments(transaction, project.id);
    const duplicate = findDuplicateRequest(pending, {
      sourceDeploymentId,
      requestedCommitSha: request.commitSha ?? null,
      serverId: project.serverId,
    });
    if (duplicate != null) {
      return { deploymentId: duplicate.id, created: false };
    }

    const now = new Date();
    cancelSupersededDeployments(transaction, pending, now);
    const deploymentId = insertQueuedDeployment(transaction, request, {
      branch: project.branch,
      serverId: project.serverId,
      source,
      now,
    });
    queueDeployment(transaction, request, { deploymentId, now });
    return { deploymentId, created: true };
  });
}

/**
 * Builds again the commit of a deployment that failed or was cancelled.
 *
 * @param database - Database.
 * @param deploymentId - Deployment to retry.
 * @param context - Who asks, for the audit log.
 * @returns The new deployment, or the identical one already waiting in the queue.
 * @throws {DeploymentNotFoundError} When the deployment does not exist.
 * @throws {RetryUnavailableError} When the deployment did not fail and was not cancelled.
 */
export function retryDeployment(
  database: Database,
  deploymentId: string,
  context: { readonly actor: Actor; readonly triggeredByUserId: string | null },
) {
  const deployment = getDeployment(database, deploymentId);
  if (deployment.status !== "failed" && deployment.status !== "cancelled") {
    throw new RetryUnavailableError(deploymentId, deployment.status);
  }
  return requestDeployment(database, {
    projectId: deployment.projectId,
    trigger: "manual",
    actor: context.actor,
    triggeredByUserId: context.triggeredByUserId,
    commitSha: deployment.commitSha ?? deployment.requestedCommitSha,
    commitMessage: deployment.commitMessage,
  });
}
