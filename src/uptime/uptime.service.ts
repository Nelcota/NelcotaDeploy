import { and, asc, eq, gte, inArray, lt, notInArray, sql } from "drizzle-orm";

import { type Database, tables } from "@/db";

import type { DownReason, ProbeResult } from "./uptime-probe";

/** Failed checks in a row before a hostname counts as down, so one lost request never alerts. */
const FAILURES_BEFORE_DOWN = 2;
const MILLISECONDS_PER_HOUR = 3_600_000;
const MILLISECONDS_PER_MINUTE = 60_000;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const PERCENT = 100;
/** Checks shown as the recent history of each hostname, one per minute. */
const RECENT_CHECKS = 30;

/** State of a hostname, as the domains page shows it. */
export type UptimeStatus = "unknown" | "up" | "down" | "private";

/** A change worth an alert. */
export type UptimeTransition = "went-down" | "recovered";

type Target = { readonly projectId: string; readonly hostname: string };

/**
 * Stores a check and updates the hostname's state.
 *
 * @param database - Database.
 * @param check - The `target` checked (project and hostname), the `result` and when it ran.
 * @returns The change to alert about, or null when the state did not cross a threshold.
 */
export function recordUptimeCheck(
  database: Database,
  check: { readonly target: Target; readonly result: ProbeResult; readonly checkedAt: Date },
): UptimeTransition | null {
  const { result, checkedAt: now } = check;
  const target = { projectId: check.target.projectId, hostname: check.target.hostname };
  return database.transaction((transaction) => {
    const previous = transaction
      .select({
        status: tables.uptimeStates.status,
        consecutiveFailures: tables.uptimeStates.consecutiveFailures,
        changedAt: tables.uptimeStates.changedAt,
      })
      .from(tables.uptimeStates)
      .where(eq(tables.uptimeStates.hostname, target.hostname))
      .get() ?? {
      status: "unknown" as const,
      consecutiveFailures: 0,
      changedAt: now.toISOString(),
    };
    const next = nextState(previous, result);
    if (result.kind === "checked") {
      transaction
        .insert(tables.uptimeChecks)
        .values({
          projectId: target.projectId,
          hostname: target.hostname,
          up: result.up,
          statusCode: result.statusCode,
          responseTimeInMs: result.responseTimeInMs,
          error: result.reason,
          checkedAt: now.toISOString(),
        })
        .run();
    }
    const changedAt = next.status === previous.status ? previous.changedAt : now.toISOString();
    transaction
      .insert(tables.uptimeStates)
      .values({ ...target, ...next, changedAt })
      .onConflictDoUpdate({
        target: tables.uptimeStates.hostname,
        set: { projectId: target.projectId, ...next, changedAt },
      })
      .run();
    return transitionBetween(previous.status, next.status);
  });
}

/**
 * Works out a hostname's state after a check: down after two failures in a row, up on the
 * first success.
 *
 * @param previous - State and failures in a row before the check.
 * @param result - What the check found.
 * @returns The new state.
 */
export function nextState(
  previous: { readonly status: UptimeStatus; readonly consecutiveFailures: number },
  result: ProbeResult,
): { readonly status: UptimeStatus; readonly consecutiveFailures: number } {
  if (result.kind === "private") {
    return { status: "private", consecutiveFailures: 0 };
  }
  if (result.up) {
    return { status: "up", consecutiveFailures: 0 };
  }
  const consecutiveFailures = previous.consecutiveFailures + 1;
  if (consecutiveFailures >= FAILURES_BEFORE_DOWN) {
    return { status: "down", consecutiveFailures };
  }
  // A single failure keeps the last known state; a private hostname now resolving to a
  // public one starts over as unknown.
  const status = previous.status === "private" ? "unknown" : previous.status;
  return { status, consecutiveFailures };
}

function transitionBetween(previous: UptimeStatus, next: UptimeStatus): UptimeTransition | null {
  if (next === "down" && previous !== "down") {
    return "went-down";
  }
  if (next === "up" && previous === "down") {
    return "recovered";
  }
  return null;
}

/**
 * Forgets the state of hostnames no longer routed, such as a removed domain.
 *
 * @param database - Database.
 * @param hostnames - Every hostname still checked.
 */
export function retainUptimeHostnames(database: Database, hostnames: readonly string[]): void {
  database
    .delete(tables.uptimeStates)
    .where(
      hostnames.length === 0 ? undefined : notInArray(tables.uptimeStates.hostname, [...hostnames]),
    )
    .run();
}

/**
 * Deletes checks older than a week; the domains page shows at most the last seven days.
 *
 * @param database - Database.
 * @param now - Current time.
 */
export function pruneUptimeChecks(database: Database, now: Date): void {
  const before = new Date(now.getTime() - DAYS_PER_WEEK * HOURS_PER_DAY * MILLISECONDS_PER_HOUR);
  database
    .delete(tables.uptimeChecks)
    .where(lt(tables.uptimeChecks.checkedAt, before.toISOString()))
    .run();
}

/**
 * Stores when a hostname's certificate expires, as read now.
 *
 * @param database - Database.
 * @param hostname - Hostname whose certificate was read.
 * @param certificate - Its expiry, or null when none could be read, and when it was read.
 */
export function recordCertificate(
  database: Database,
  hostname: string,
  certificate: { readonly expiresAt: Date | null; readonly checkedAt: Date },
): void {
  database
    .update(tables.uptimeStates)
    .set({
      certificateExpiresAt: certificate.expiresAt?.toISOString() ?? null,
      certificateCheckedAt: certificate.checkedAt.toISOString(),
    })
    .where(eq(tables.uptimeStates.hostname, hostname))
    .run();
}

/**
 * Remembers that a certificate alert went out, so it repeats only a week later.
 *
 * @param database - Database.
 * @param hostname - Hostname alerted about.
 * @param at - When the alert went out.
 */
export function recordCertificateAlert(database: Database, hostname: string, at: Date): void {
  database
    .update(tables.uptimeStates)
    .set({ certificateAlertedAt: at.toISOString() })
    .where(eq(tables.uptimeStates.hostname, hostname))
    .run();
}

/**
 * Reads the certificate fields of the hostnames that were checked.
 *
 * @param database - Database.
 * @param hostnames - Hostnames to read.
 * @returns Their certificate expiry and last alert, by hostname.
 */
export function listCertificateStates(
  database: Database,
  hostnames: readonly string[],
): Map<string, { readonly expiresAt: Date | null; readonly alertedAt: Date | null }> {
  if (hostnames.length === 0) {
    return new Map();
  }
  const rows = database
    .select({
      hostname: tables.uptimeStates.hostname,
      expiresAt: tables.uptimeStates.certificateExpiresAt,
      alertedAt: tables.uptimeStates.certificateAlertedAt,
    })
    .from(tables.uptimeStates)
    .where(inArray(tables.uptimeStates.hostname, hostnames))
    .all();
  return new Map(
    rows.map((row) => [
      row.hostname,
      {
        expiresAt: row.expiresAt == null ? null : new Date(row.expiresAt),
        alertedAt: row.alertedAt == null ? null : new Date(row.alertedAt),
      },
    ]),
  );
}

/** Availability of one hostname for the domains page. */
export type UptimeSummary = {
  readonly hostname: string;
  readonly status: UptimeStatus;
  readonly changedAt: string;
  /** Share of checks that found it up, 0–100; null without checks in the window. */
  readonly uptimeLastDayPercent: number | null;
  readonly uptimeLastWeekPercent: number | null;
  readonly lastResponseTimeInMs: number | null;
  readonly lastReason: DownReason | null;
  readonly certificateExpiresAt: string | null;
  /** The latest checks, oldest first. */
  readonly recent: readonly { readonly up: boolean; readonly checkedAt: string }[];
};

/**
 * Summarizes the availability of a project's hostnames, in a fixed number of queries.
 *
 * @param database - Database.
 * @param projectId - Project.
 * @param now - Current time.
 * @returns One summary per checked hostname, sorted by hostname.
 */
export function listUptimeSummaries(
  database: Database,
  projectId: string,
  now: Date,
): UptimeSummary[] {
  const states = database
    .select({
      hostname: tables.uptimeStates.hostname,
      status: tables.uptimeStates.status,
      changedAt: tables.uptimeStates.changedAt,
      certificateExpiresAt: tables.uptimeStates.certificateExpiresAt,
    })
    .from(tables.uptimeStates)
    .where(eq(tables.uptimeStates.projectId, projectId))
    .orderBy(asc(tables.uptimeStates.hostname))
    .all();
  if (states.length === 0) {
    return [];
  }
  const dayAgo = new Date(now.getTime() - HOURS_PER_DAY * MILLISECONDS_PER_HOUR).toISOString();
  const weekAgo = new Date(
    now.getTime() - DAYS_PER_WEEK * HOURS_PER_DAY * MILLISECONDS_PER_HOUR,
  ).toISOString();
  const totals = new Map(
    database
      .select({
        hostname: tables.uptimeChecks.hostname,
        dayTotal: sql<number>`sum(case when ${tables.uptimeChecks.checkedAt} >= ${dayAgo} then 1 else 0 end)`,
        dayUp: sql<number>`sum(case when ${tables.uptimeChecks.checkedAt} >= ${dayAgo} and ${tables.uptimeChecks.up} = 1 then 1 else 0 end)`,
        weekTotal: sql<number>`count(*)`,
        weekUp: sql<number>`sum(case when ${tables.uptimeChecks.up} = 1 then 1 else 0 end)`,
      })
      .from(tables.uptimeChecks)
      .where(
        and(
          eq(tables.uptimeChecks.projectId, projectId),
          gte(tables.uptimeChecks.checkedAt, weekAgo),
        ),
      )
      .groupBy(tables.uptimeChecks.hostname)
      .all()
      .map((row) => [row.hostname, row]),
  );
  const recentByHostname = recentChecks(database, projectId, now);
  return states.map((state) => {
    const total = totals.get(state.hostname);
    const recent = recentByHostname.get(state.hostname) ?? [];
    const last = recent.at(-1);
    return {
      hostname: state.hostname,
      status: state.status,
      changedAt: state.changedAt,
      uptimeLastDayPercent: percentOf(total?.dayUp ?? 0, total?.dayTotal ?? 0),
      uptimeLastWeekPercent: percentOf(total?.weekUp ?? 0, total?.weekTotal ?? 0),
      lastResponseTimeInMs: last?.responseTimeInMs ?? null,
      lastReason: last?.reason ?? null,
      certificateExpiresAt: state.certificateExpiresAt,
      recent: recent.map((check) => ({ up: check.up, checkedAt: check.checkedAt })),
    };
  });
}

/** The checks of the last half hour, oldest first, by hostname. */
function recentChecks(database: Database, projectId: string, now: Date) {
  const since = new Date(now.getTime() - RECENT_CHECKS * MILLISECONDS_PER_MINUTE);
  const rows = database
    .select({
      hostname: tables.uptimeChecks.hostname,
      up: tables.uptimeChecks.up,
      responseTimeInMs: tables.uptimeChecks.responseTimeInMs,
      reason: tables.uptimeChecks.error,
      checkedAt: tables.uptimeChecks.checkedAt,
    })
    .from(tables.uptimeChecks)
    .where(
      and(
        eq(tables.uptimeChecks.projectId, projectId),
        gte(tables.uptimeChecks.checkedAt, since.toISOString()),
      ),
    )
    .orderBy(asc(tables.uptimeChecks.checkedAt), asc(tables.uptimeChecks.id))
    .all()
    .map((row) => ({
      hostname: row.hostname,
      up: row.up,
      responseTimeInMs: row.responseTimeInMs,
      reason: asReason(row.reason),
      checkedAt: row.checkedAt,
    }));
  return Map.groupBy(rows, (row) => row.hostname);
}

const REASONS = ["dns", "timeout", "certificate", "connection", "server-error"] as const;

function asReason(value: string | null): DownReason | null {
  return REASONS.find((reason) => reason === value) ?? null;
}

function percentOf(part: number, total: number): number | null {
  if (total === 0) {
    return null;
  }
  const percent = (part / total) * PERCENT;
  return Number.isFinite(percent) ? percent : null;
}
