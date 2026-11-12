import { and, asc, eq, isNotNull, isNull, lte } from "drizzle-orm";

import { type Database, tables } from "@/db";
import { appCloneToken, getGitHubPullRequest, type GitHubPullRequest } from "@/github";
import { createLogger } from "@/logging";
import { readRepositoryToken } from "@/projects";
import type { SecretBox } from "@/secrets";

import {
  appliesToPreviews,
  applyPullRequest,
  findPreviewProjects,
  hasPreviewForPullRequest,
  parsePullRequest,
  pullRequestDetails,
} from "./pull-request-event";
import { ignored, type ProcessedEvent, recordWebhookOutcome } from "./webhook-event";

const reconciliations = tables.pullRequestReconciliations;
type Reconciliation = typeof reconciliations.$inferSelect;
type PullRequestTarget = Pick<Reconciliation, "repositoryFullName" | "pullRequestNumber">;
type ClaimedReconciliation = Reconciliation & { readonly nextAttemptAt: string };
type ReadSnapshot = (target: PullRequestTarget) => Promise<GitHubPullRequest>;

const BATCH_SIZE = 8;
const CLAIM_IN_MS = 120_000;
const RETRY_BASE_IN_MS = 15_000;
const MAX_RETRY_EXPONENT = 7;
const logger = createLogger("preview-reconciliation");

function targetCondition(target: PullRequestTarget) {
  return and(
    eq(reconciliations.repositoryFullName, target.repositoryFullName),
    eq(reconciliations.pullRequestNumber, target.pullRequestNumber),
  );
}

function claimCondition(claim: ClaimedReconciliation) {
  return and(
    targetCondition(claim),
    eq(reconciliations.deliveryId, claim.deliveryId),
    eq(reconciliations.nextAttemptAt, claim.nextAttemptAt),
  );
}

export function queuePullRequestReconciliation(
  database: Database,
  deliveryId: string,
  rawBody: string,
): ProcessedEvent {
  const payload = parsePullRequest(rawBody);
  if (payload == null) {
    return ignored("pull request payload is missing required fields");
  }

  const details = pullRequestDetails(payload);
  if (appliesToPreviews(payload) === false) {
    return ignored(`pull request ${payload.action} is not handled`, details);
  }

  const target = {
    repositoryFullName: details.repositoryFullName,
    pullRequestNumber: payload.number,
  };
  const known = database
    .select({
      deliveryId: reconciliations.deliveryId,
      nextAttemptAt: reconciliations.nextAttemptAt,
    })
    .from(reconciliations)
    .where(targetCondition(target))
    .get();
  if (
    known == null &&
    hasPreviewForPullRequest(database, target.repositoryFullName, payload.number) === false &&
    findPreviewProjects(database, payload).length === 0
  ) {
    return ignored("no approved project with previews for this pull request", details);
  }

  const pending = {
    deliveryId,
    senderLogin: payload.sender?.login ?? null,
    nextAttemptAt: new Date().toISOString(),
    attempts: 0,
  };
  if (known?.nextAttemptAt != null) {
    database
      .update(tables.webhookDeliveries)
      .set({ status: "ignored", reason: "superseded by a newer reconciliation request" })
      .where(eq(tables.webhookDeliveries.id, known.deliveryId))
      .run();
  }

  database
    .insert(reconciliations)
    .values({ ...target, ...pending })
    .onConflictDoUpdate({
      target: [reconciliations.repositoryFullName, reconciliations.pullRequestNumber],
      set: pending,
    })
    .run();
  return {
    ...details,
    result: { status: "accepted", deploymentIds: [] },
    acceptedReason: "pull request reconciliation queued",
  };
}

function claimDue(database: Database, now: Date): ClaimedReconciliation[] {
  const available = lte(reconciliations.nextAttemptAt, now.toISOString());
  const due = database
    .select()
    .from(reconciliations)
    .where(available)
    .orderBy(asc(reconciliations.nextAttemptAt))
    .limit(BATCH_SIZE)
    .all();
  const nextAttemptAt = new Date(now.getTime() + CLAIM_IN_MS).toISOString();
  return due.flatMap((candidate) => {
    const claimed = database
      .update(reconciliations)
      .set({ nextAttemptAt })
      .where(
        and(
          available,
          targetCondition(candidate),
          eq(reconciliations.deliveryId, candidate.deliveryId),
        ),
      )
      .returning()
      .all()
      .at(0);
    return claimed == null ? [] : [{ ...claimed, nextAttemptAt }];
  });
}

function applySnapshot(
  database: Database,
  claim: ClaimedReconciliation,
  snapshot: GitHubPullRequest,
): void {
  const observation = {
    observedState: snapshot.state,
    observedHeadSha: snapshot.head.sha,
    observedHeadRef: snapshot.head.ref,
    observedHeadRepository: snapshot.head.repo?.full_name.toLowerCase() ?? null,
    observedBaseRef: snapshot.base.ref,
  };
  database.transaction(
    (transaction) => {
      const applied = transaction
        .update(reconciliations)
        .set({
          ...observation,
          nextAttemptAt: null,
          attempts: 0,
        })
        .where(claimCondition(claim))
        .returning({ deliveryId: reconciliations.deliveryId })
        .all();
      if (applied.length === 0) {
        return;
      }

      const unchanged =
        claim.observedState === observation.observedState &&
        claim.observedHeadSha === observation.observedHeadSha &&
        claim.observedHeadRef === observation.observedHeadRef &&
        claim.observedHeadRepository === observation.observedHeadRepository &&
        claim.observedBaseRef === observation.observedBaseRef;
      const payload = {
        number: claim.pullRequestNumber,
        action: snapshot.state === "closed" ? "closed" : "synchronize",
        pull_request: snapshot,
        ...(claim.senderLogin == null ? {} : { sender: { login: claim.senderLogin } }),
      };
      const outcome = unchanged
        ? ignored("pull request state already reconciled", pullRequestDetails(payload))
        : applyPullRequest(database, payload);
      recordWebhookOutcome(transaction, claim.deliveryId, outcome);
    },
    { behavior: "immediate" },
  );
}

function retry(
  database: Database,
  claim: ClaimedReconciliation,
  { error, now }: { readonly error: unknown; readonly now: Date },
): void {
  const attempts = Math.min(claim.attempts + 1, MAX_RETRY_EXPONENT);
  const delay = RETRY_BASE_IN_MS * 2 ** attempts;
  const updated = database
    .update(reconciliations)
    .set({
      attempts,
      nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
    })
    .where(claimCondition(claim))
    .returning({ deliveryId: reconciliations.deliveryId })
    .all();
  if (updated.length > 0) {
    logger.warn(
      {
        repository: claim.repositoryFullName,
        pullRequestNumber: claim.pullRequestNumber,
        attempts,
        err: error,
      },
      "pull request reconciliation failed",
    );
  }
}

async function loadSnapshot(
  database: Database,
  secretBox: SecretBox,
  target: PullRequestTarget,
): Promise<GitHubPullRequest> {
  const { repositoryFullName, pullRequestNumber } = target;
  const appToken = await appCloneToken(database, secretBox, repositoryFullName);
  if (appToken != null) {
    return await getGitHubPullRequest({
      repositoryFullName,
      number: pullRequestNumber,
      token: appToken,
    });
  }

  const project = database
    .select({ id: tables.projects.id })
    .from(tables.projects)
    .where(
      and(
        eq(tables.projects.repositoryFullName, repositoryFullName),
        eq(tables.projects.deploymentsApproved, true),
        isNull(tables.projects.deletionRequestedAt),
        isNotNull(tables.projects.encryptedRepositoryToken),
      ),
    )
    .orderBy(asc(tables.projects.id))
    .get();
  const token = project == null ? null : await readRepositoryToken(database, secretBox, project.id);
  return await getGitHubPullRequest({ repositoryFullName, number: pullRequestNumber, token });
}

/**
 * Reconciles a bounded batch of pending pull requests outside the webhook response path.
 *
 * @param database - Platform database.
 * @param secretBox - Repository and GitHub App credential decryptor.
 * @param options - Clock and snapshot reader for deterministic integration tests.
 */
export async function reconcilePullRequests(
  database: Database,
  secretBox: SecretBox,
  options: { readonly now?: Date; readonly readSnapshot?: ReadSnapshot } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  const readSnapshot =
    options.readSnapshot ?? ((target) => loadSnapshot(database, secretBox, target));
  const claimed = claimDue(database, now);
  const results = await Promise.allSettled(
    claimed.map(async (claim) => {
      try {
        const snapshot = await readSnapshot(claim);
        applySnapshot(database, claim, snapshot);
      } catch (error) {
        retry(database, claim, { error, now: options.now ?? new Date() });
      }
    }),
  );
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    throw failed.reason;
  }
}
