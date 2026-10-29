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
const logger = createLogger("github-webhook");

const pushPayloadSchema = z.object({
  ref: z.string().max(300),
  after: z.string().regex(/^[a-f0-9]{40}$/),
  deleted: z.boolean().optional(),
  repository: z.object({ full_name: z.string().max(200) }),
  head_commit: z.object({ message: z.string() }).nullable().optional(),
  pusher: z.object({ name: z.string().max(200) }).optional(),
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
 * @param secret - Shared webhook secret.
 * @returns The outcome.
 * @throws {InvalidWebhookSignatureError} When the signature is missing or wrong.
 * @throws {InvalidWebhookRequestError} When the delivery id or event header is malformed.
 */
export async function handleGitHubDelivery(
  database: Database,
  delivery: GitHubDelivery,
  secret: string,
): Promise<WebhookOutcome> {
  if (delivery.signature == null || delivery.signature === "") {
    throw new InvalidWebhookSignatureError();
  }
  const valid = await new Webhooks({ secret }).verify(delivery.rawBody, delivery.signature);
  if (valid === false) {
    throw new InvalidWebhookSignatureError();
  }
  if (delivery.deliveryId == null || DELIVERY_ID_PATTERN.test(delivery.deliveryId) === false) {
    throw new InvalidWebhookRequestError("Missing or malformed X-GitHub-Delivery header");
  }
  if (delivery.event == null || EVENT_PATTERN.test(delivery.event) === false) {
    throw new InvalidWebhookRequestError("Missing or malformed X-GitHub-Event header");
  }
  const deliveryId = delivery.deliveryId;
  // A skipped or unmatched write returns no row, which `.get()` does not admit in its type.
  const claimed = database
    .insert(tables.webhookDeliveries)
    .values({
      id: deliveryId,
      event: delivery.event,
      status: "ignored",
      reason: "processing",
      deploymentIds: [],
      receivedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .returning({ id: tables.webhookDeliveries.id })
    .all()
    .at(0);
  if (claimed == null) {
    return { status: "duplicate" };
  }
  const outcome = processEvent(database, delivery.event, delivery.rawBody);
  database
    .update(tables.webhookDeliveries)
    .set({
      status: outcome.result.status === "accepted" ? "accepted" : "ignored",
      reason: outcome.result.status === "ignored" ? outcome.result.reason : "deployments queued",
      deploymentIds: outcome.result.status === "accepted" ? [...outcome.result.deploymentIds] : [],
      repositoryFullName: outcome.repositoryFullName,
      ref: outcome.ref,
      commitSha: outcome.commitSha,
    })
    .where(eq(tables.webhookDeliveries.id, deliveryId))
    .run();
  return outcome.result;
}

type ProcessedEvent = {
  readonly result: Exclude<WebhookOutcome, { status: "duplicate" }>;
  readonly repositoryFullName: string | null;
  readonly ref: string | null;
  readonly commitSha: string | null;
};

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
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return ignored("payload is not valid JSON");
  }
  const parsed = pushPayloadSchema.safeParse(json);
  if (parsed.success === false) {
    return ignored("push payload is missing required fields");
  }
  const payload = parsed.data;
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
  const projects = database
    .select({ id: tables.projects.id, deploymentsApproved: tables.projects.deploymentsApproved })
    .from(tables.projects)
    .where(
      and(
        eq(tables.projects.repositoryFullName, details.repositoryFullName),
        eq(tables.projects.branch, branch),
        eq(tables.projects.autoDeploy, true),
        isNull(tables.projects.deletionRequestedAt),
      ),
    )
    .all();
  const approved = projects.filter((project) => project.deploymentsApproved);
  if (approved.length === 0) {
    return ignored("no approved project with auto-deploy for this repository and branch", details);
  }
  const pusher = payload.pusher?.name ?? "unknown";
  // Like `git log --format=%s`: only the subject line is kept.
  const commitMessage =
    (payload.head_commit?.message ?? "").split("\n")[0]?.trim().slice(0, 500) ?? "";
  const deploymentIds = approved.map(
    (project) =>
      requestDeployment(database, {
        projectId: project.id,
        trigger: "webhook",
        actor: { type: "webhook", label: `github:${pusher}` },
        triggeredByUserId: null,
        commitSha: payload.after,
        commitMessage,
      }).deploymentId,
  );
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
