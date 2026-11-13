import type { DomainDns } from "../domains";
import type { DomainUptime } from "./uptime-state";

const CHECK_FRESHNESS_IN_MS = 180_000;
const CLOCK_TOLERANCE_IN_MS = 30_000;
const CERTIFICATE_WAIT_IN_MS = 300_000;

/** Prefers a fresh manual success only while the worker has no newer observation. */
export function manualHttpsIsCurrent({
  checkedAt,
  latestCheckAt,
  now,
}: {
  readonly checkedAt: string;
  readonly latestCheckAt: string | null;
  readonly now: Date;
}): boolean {
  return checkIsCurrent(checkedAt, latestCheckAt, now) && checkedAt !== latestCheckAt;
}

/** Reports public access only after a recent check made after the release was applied. */
export function domainAccess({
  pending,
  publishedAt,
  uptime,
  now,
}: {
  readonly pending: boolean;
  readonly publishedAt: string | null;
  readonly uptime: Pick<DomainUptime, "status" | "recent"> | undefined;
  readonly now: Date;
}) {
  if (pending) {
    return "pending";
  }

  if (uptime?.status === "private") {
    return "private";
  }

  const last = uptime?.recent.at(-1);
  if (last == null || checkIsCurrent(last.checkedAt, publishedAt, now) === false) {
    return "checking";
  }

  if (last.up) {
    return "ready";
  }

  const { reason } = last;
  if (reason === "dns" || reason === "certificate") {
    return reason;
  }

  return "unreachable";
}

/** Distinguishes propagation and initial HTTPS validation from a persistent access failure. */
export function domainProgress({
  access,
  dns,
  httpsEnabled,
  uptime,
  now,
}: {
  readonly access: ReturnType<typeof domainAccess>;
  readonly dns: DomainDns | undefined;
  readonly httpsEnabled: boolean;
  readonly uptime: Pick<DomainUptime, "recent" | "certificateExpiresAt"> | undefined;
  readonly now: Date;
}) {
  if (access === "checking" || access === "dns") {
    if (dns?.status === "ok") {
      return httpsEnabled ? "waiting-for-https" : "waiting-for-http";
    }

    if (dns?.status === "missing") {
      return "dns";
    }
  }

  if (access === "certificate" && httpsEnabled && certificateMayBeIssuing(uptime, now)) {
    return "waiting-for-https";
  }

  return access;
}

function certificateMayBeIssuing(
  uptime: Pick<DomainUptime, "recent" | "certificateExpiresAt"> | undefined,
  now: Date,
): boolean {
  if (
    uptime == null ||
    uptime.certificateExpiresAt != null ||
    uptime.recent.some((check) => check.up)
  ) {
    return false;
  }

  const startedAt = certificateFailureStartedAt(uptime.recent);
  if (startedAt == null) {
    return false;
  }

  const elapsed = now.getTime() - Date.parse(startedAt);
  return (
    Number.isFinite(elapsed) &&
    elapsed >= -CLOCK_TOLERANCE_IN_MS &&
    elapsed < CERTIFICATE_WAIT_IN_MS
  );
}

/** First observed failure in the current streak of certificate validation failures. */
export function certificateFailureStartedAt(recent: DomainUptime["recent"]): string | null {
  const priorCheck = recent.findLastIndex((check) => check.reason !== "certificate");
  const firstFailure = recent.at(priorCheck + 1);
  if (firstFailure == null || Number.isFinite(Date.parse(firstFailure.checkedAt)) === false) {
    return null;
  }

  return firstFailure.checkedAt;
}

/** Keeps the earliest known time without presenting it as the issuer's start time. */
export function certificateWaitStartedAt({
  firstFailureAt,
  firstObservedAt,
}: {
  readonly firstFailureAt: string | null;
  readonly firstObservedAt: string;
}): string {
  if (firstFailureAt != null && Date.parse(firstFailureAt) < Date.parse(firstObservedAt)) {
    return firstFailureAt;
  }

  return firstObservedAt;
}

function checkIsCurrent(check: string, publishedAt: string | null, now: Date): boolean {
  const checkedAt = Date.parse(check);
  const releaseAt = publishedAt == null ? null : Date.parse(publishedAt);
  const age = now.getTime() - checkedAt;
  return (
    Number.isFinite(age) &&
    age >= -CLOCK_TOLERANCE_IN_MS &&
    age <= CHECK_FRESHNESS_IN_MS &&
    (releaseAt == null || (Number.isFinite(releaseAt) && checkedAt >= releaseAt))
  );
}
