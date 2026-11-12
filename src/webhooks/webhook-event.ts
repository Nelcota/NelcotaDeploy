import { eq } from "drizzle-orm";

import { type Database, tables, type Transaction } from "@/db";

import { InvalidWebhookSignatureError } from "./webhook.errors";

const MAX_COMMIT_SUBJECT_LENGTH = 500;
const GITHUB_SIGNATURE_PATTERN = /^sha256=[0-9a-f]{64}$/;

/** Checks the signature header format before hashing the request. */
export function requireGitHubSignature(signature: string | null): string {
  if (signature == null || GITHUB_SIGNATURE_PATTERN.test(signature) === false) {
    throw new InvalidWebhookSignatureError();
  }

  return signature;
}

/** Returned by {@link parseJsonBody} for a body that is not JSON. */
export const INVALID_JSON = Symbol("invalid JSON");

/** How a delivery was handled. */
export type WebhookOutcome =
  | { readonly status: "duplicate" }
  | { readonly status: "ignored"; readonly reason: string }
  | { readonly status: "accepted"; readonly deploymentIds: readonly string[] };

/** What handling one event did, and what the delivery log records about it. */
export type ProcessedEvent = {
  readonly result: Exclude<WebhookOutcome, { status: "duplicate" }>;
  readonly repositoryFullName: string | null;
  readonly ref: string | null;
  readonly commitSha: string | null;
  readonly acceptedReason?: string;
};

export function recordWebhookOutcome(
  database: Database | Transaction,
  deliveryId: string,
  outcome: ProcessedEvent,
): void {
  const { result } = outcome;
  database
    .update(tables.webhookDeliveries)
    .set({
      status: result.status,
      reason:
        result.status === "ignored"
          ? result.reason
          : (outcome.acceptedReason ?? "deployments queued"),
      deploymentIds: result.status === "accepted" ? [...result.deploymentIds] : [],
      repositoryFullName: outcome.repositoryFullName,
      ref: outcome.ref,
      commitSha: outcome.commitSha,
    })
    .where(eq(tables.webhookDeliveries.id, deliveryId))
    .run();
}

/**
 * Records a delivery that queued nothing, with the reason.
 *
 * @param reason - Why the event was ignored.
 * @param details - Repository, ref and commit to record, when known.
 * @returns The processed event.
 */
export function ignored(reason: string, details: Partial<ProcessedEvent> = {}): ProcessedEvent {
  return {
    result: { status: "ignored", reason },
    repositoryFullName: details.repositoryFullName ?? null,
    ref: details.ref ?? null,
    commitSha: details.commitSha ?? null,
  };
}

/**
 * Parses a webhook body.
 *
 * @param rawBody - Body as received.
 * @returns The parsed value, or {@link INVALID_JSON}.
 */
export function parseJsonBody(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    // Not an error of ours: the delivery is recorded as ignored with this reason.
    return INVALID_JSON;
  }
}

/**
 * Keeps only the subject line, like `git log --format=%s`.
 *
 * @param message - Commit message or pull request title.
 * @returns The first line, trimmed and at most 500 characters.
 */
export function commitSubject(message: string): string {
  const newline = message.indexOf("\n");
  const subject = newline < 0 ? message : message.slice(0, newline);
  return subject.trim().slice(0, MAX_COMMIT_SUBJECT_LENGTH);
}
