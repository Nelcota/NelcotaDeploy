import { Webhooks } from "@octokit/webhooks";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { type Database, tables } from "@/db";
import { requestDeployment } from "@/deployments";
import { createLogger, singleLine } from "@/logging";

import { InvalidWebhookRequestError, InvalidWebhookSignatureError } from "./webhook.errors";

const DELIVERY_ID_PATTERN = /^[A-Za-z0-9-]{1,100}$/;
const EVENT_PATTERN = /^[a-z_]{1,64}$/;
const ZERO_SHA = /^0+$/;
const BRANCH_REF_PREFIX = "refs/heads/";
const MAX_LIST_SIZE = 100;
const MAX_REF_LENGTH = 300;
const MAX_GITHUB_NAME_LENGTH = 200;
const MAX_COMMIT_SUBJECT_LENGTH = 500;
const logger = createLogger("github-webhook");

const pushPayloadSchema = z.object({
  ref: z.string().max(MAX_REF_LENGTH),
  after: z.string().regex(/^[a-f0-9]{40}$/),
  deleted: z.boolean().optional(),
  repository: z.object({ full_name: z.string().max(MAX_GITHUB_NAME_LENGTH) }),
  head_commit: z.object({ message: z.string() }).nullable().optional(),
  pusher: z.object({ name: z.string().max(MAX_GITHUB_NAME_LENGTH) }).optional(),
});

/** Raw webhook request as received over HTTP. */
export type GitHubDelivery = {
  readonly deliveryId: string | null;
  readonly event: string | null;
  readonly signature: string | null;
  /** Unparsed request body; the signature covers these exact bytes. */
  readonly rawBody: string;
};

/** How a delivery was handled. */
export type WebhookOutcome =
  | { readonly status: "duplicate" }
  | { readonly status: "ignored"; readonly reason: string }
  | { readonly status: "accepted"; readonly deploymentIds: readonly string[] };

/**
 * Verifies and processes a GitHub webhook delivery.
 *
 * @remarks
 * The HMAC SHA-256 signature is checked against the raw body before anything else. The
 * delivery id is stored first with a unique key, so GitHub retries never deploy twice.
 * A push deploys every approved project with auto-deploy on for that repository and branch,
 * at the exact pushed commit.
 *
 * @param database - Database.
 * @param delivery - Headers and raw body.
 * @param secrets - Accepted webhook secrets: the GitHub App's and the one set by hand.
 * @returns The outcome.
 * @throws {InvalidWebhookSignatureError} When the signature is missing or wrong.
 * @throws {InvalidWebhookRequestError} When the delivery id or event header is malformed.
 */
export async function handleGitHubDelivery(
  database: Database,
  delivery: GitHubDelivery,
  secrets: readonly string[],
): Promise<WebhookOutcome> {
  const { deliveryId, event } = await verifyDelivery(delivery, secrets);
  const claimed = claimDelivery(database, deliveryId, event);
  if (claimed === false) {
    return { status: "duplicate" };
  }
  const outcome = processEvent(database, event, delivery.rawBody);
  recordOutcome(database, deliveryId, outcome);
  return outcome.result;
}

async function isSignedWithAny(
  delivery: GitHubDelivery & { readonly signature: string },
  secrets: readonly string[],
): Promise<boolean> {
  const checks = await Promise.all(
    secrets.map(
      async (secret) => await new Webhooks({ secret }).verify(delivery.rawBody, delivery.signature),
    ),
  );
  return checks.includes(true);
}

async function verifyDelivery(
  delivery: GitHubDelivery,
  secrets: readonly string[],
): Promise<{ readonly deliveryId: string; readonly event: string }> {
  if (delivery.signature == null || delivery.signature === "") {
    throw new InvalidWebhookSignatureError();
  }
  const valid = await isSignedWithAny({ ...delivery, signature: delivery.signature }, secrets);
  if (valid === false) {
    throw new InvalidWebhookSignatureError();
  }
  if (delivery.deliveryId == null || DELIVERY_ID_PATTERN.test(delivery.deliveryId) === false) {
    throw new InvalidWebhookRequestError("Missing or malformed X-GitHub-Delivery header");
  }
  if (delivery.event == null || EVENT_PATTERN.test(delivery.event) === false) {
    throw new InvalidWebhookRequestError("Missing or malformed X-GitHub-Event header");
  }
  return { deliveryId: delivery.deliveryId, event: delivery.event };
}

/** Stores the delivery id first; returns false when GitHub already sent this delivery. */
function claimDelivery(database: Database, deliveryId: string, event: string): boolean {
  // A skipped or unmatched write returns no row, which `.get()` does not admit in its type.
  const claimed = database
    .insert(tables.webhookDeliveries)
    .values({
      id: deliveryId,
      event,
      status: "ignored",
      reason: "processing",
      deploymentIds: [],
      receivedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .returning({ id: tables.webhookDeliveries.id })
    .all()
    .at(0);
  return claimed != null;
}

function recordOutcome(database: Database, deliveryId: string, outcome: ProcessedEvent): void {
  const { result } = outcome;
  database
    .update(tables.webhookDeliveries)
    .set({
      status: result.status === "accepted" ? "accepted" : "ignored",
      reason: result.status === "ignored" ? result.reason : "deployments queued",
      deploymentIds: result.status === "accepted" ? [...result.deploymentIds] : [],
      repositoryFullName: outcome.repositoryFullName,
      ref: outcome.ref,
      commitSha: outcome.commitSha,
    })
    .where(eq(tables.webhookDeliveries.id, deliveryId))
    .run();
}

type ProcessedEvent = {
  readonly result: Exclude<WebhookOutcome, { status: "duplicate" }>;
  readonly repositoryFullName: string | null;
  readonly ref: string | null;
  readonly commitSha: string | null;
};

type PushPayload = z.infer<typeof pushPayloadSchema>;

function ignored(reason: string, details: Partial<ProcessedEvent> = {}): ProcessedEvent {
  return {
    result: { status: "ignored", reason },
    repositoryFullName: details.repositoryFullName ?? null,
    ref: details.ref ?? null,
    commitSha: details.commitSha ?? null,
  };
}

function processEvent(database: Database, event: string, rawBody: string): ProcessedEvent {
  if (event === "ping") {
    return ignored("ping");
  }
  if (event !== "push") {
    return ignored(`event ${event} is not handled`);
  }
  const payload = parsePushPayload(rawBody);
  if (typeof payload === "string") {
    return ignored(payload);
  }
  return processPush(database, payload);
}

/** Returns the parsed push payload, or the reason it was rejected. */
function parsePushPayload(rawBody: string): PushPayload | string {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return "payload is not valid JSON";
  }
  const parsed = pushPayloadSchema.safeParse(json);
  if (parsed.success === false) {
    return "push payload is missing required fields";
  }
  return parsed.data;
}

function processPush(database: Database, payload: PushPayload): ProcessedEvent {
  const details = {
    repositoryFullName: payload.repository.full_name.toLowerCase(),
    ref: payload.ref,
    commitSha: payload.after,
  };
  if (payload.deleted === true || ZERO_SHA.test(payload.after)) {
    return ignored("branch deletion", details);
  }
  if (payload.ref.startsWith(BRANCH_REF_PREFIX) === false) {
    return ignored("not a branch push", details);
  }
  const branch = payload.ref.slice(BRANCH_REF_PREFIX.length);
  const projectIds = findAutoDeployProjects(database, details.repositoryFullName, branch);
  if (projectIds.length === 0) {
    return ignored("no approved project with auto-deploy for this repository and branch", details);
  }
  const deploymentIds = queueDeployments(database, projectIds, payload);
  logger.info(
    {
      repository: details.repositoryFullName,
      branch: singleLine(branch),
      deployments: deploymentIds.length,
    },
    "push webhook queued deployments",
  );
  return { result: { status: "accepted", deploymentIds }, ...details };
}

/** Ids of the approved, auto-deploying projects that follow this repository and branch. */
function findAutoDeployProjects(
  database: Database,
  repositoryFullName: string,
  branch: string,
): string[] {
  const projects = database
    .select({ id: tables.projects.id, deploymentsApproved: tables.projects.deploymentsApproved })
    .from(tables.projects)
    .where(
      and(
        eq(tables.projects.repositoryFullName, repositoryFullName),
        eq(tables.projects.branch, branch),
        eq(tables.projects.autoDeploy, true),
        isNull(tables.projects.deletionRequestedAt),
      ),
    )
    .all();
  return projects.filter((project) => project.deploymentsApproved).map((project) => project.id);
}

function queueDeployments(
  database: Database,
  projectIds: readonly string[],
  payload: PushPayload,
): string[] {
  const pusher = payload.pusher?.name ?? "unknown";
  const commitMessage = commitSubject(payload.head_commit?.message ?? "");
  return projectIds.map(
    (projectId) =>
      requestDeployment(database, {
        projectId,
        trigger: "webhook",
        actor: { type: "webhook", label: `github:${pusher}` },
        triggeredByUserId: null,
        commitSha: payload.after,
        commitMessage,
      }).deploymentId,
  );
}

/** Like `git log --format=%s`: only the subject line is kept. */
function commitSubject(message: string): string {
  return (message.split("\n")[0] ?? "").trim().slice(0, MAX_COMMIT_SUBJECT_LENGTH);
}

/**
 * Lists recent webhook deliveries, newest first.
 *
 * @param database - Database.
 * @param limit - Page size, at most 100.
 * @returns Deliveries.
 */
export function listWebhookDeliveries(database: Database, limit: number) {
  return database
    .select({
      id: tables.webhookDeliveries.id,
      event: tables.webhookDeliveries.event,
      repositoryFullName: tables.webhookDeliveries.repositoryFullName,
      ref: tables.webhookDeliveries.ref,
      commitSha: tables.webhookDeliveries.commitSha,
      status: tables.webhookDeliveries.status,
      reason: tables.webhookDeliveries.reason,
      deploymentIds: tables.webhookDeliveries.deploymentIds,
      receivedAt: tables.webhookDeliveries.receivedAt,
    })
    .from(tables.webhookDeliveries)
    .orderBy(desc(tables.webhookDeliveries.receivedAt))
    .limit(Math.min(Math.max(Math.trunc(limit), 1), MAX_LIST_SIZE))
    .all();
}
