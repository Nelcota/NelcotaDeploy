const MAX_COMMIT_SUBJECT_LENGTH = 500;

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
};

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
  return (message.split("\n")[0] ?? "").trim().slice(0, MAX_COMMIT_SUBJECT_LENGTH);
}
