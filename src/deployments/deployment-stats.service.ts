import { and, gte, isNull } from "drizzle-orm";

import { type Database, tables } from "@/db";
import { dayKey, durationBetween } from "@/shared/format";

const MILLISECONDS_PER_DAY = 86_400_000;
const MAX_DAYS = 30;
const PERCENT = 100;

/** Deploys of one calendar day (São Paulo time), split by outcome. */
type DeploymentDay = {
  /** The day as "YYYY-MM-DD". */
  readonly day: string;
  readonly succeeded: number;
  readonly failed: number;
  /** Cancelled, queued or still running. */
  readonly other: number;
};

/** Summary of the deploys requested in a recent window. */
export type DeploymentStats = {
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: number;
  /** Share of finished deploys (succeeded or failed) that succeeded, 0–100; null without any. */
  readonly successRatePercent: number | null;
  /** Mean time from start to finish of the succeeded deploys, in ms; null without any. */
  readonly averageDurationInMs: number | null;
  /** One entry per day of the window, oldest first, including days without deploys. */
  readonly days: readonly DeploymentDay[];
};

/**
 * Summarizes the deploys of the last days: totals by outcome, success rate, average
 * duration and a per-day breakdown for a chart.
 *
 * @param database - Database.
 * @param options - `days` is the window length, between 1 and 30, ending today; `now` is
 * injectable for tests.
 * @returns The summary of every deploy created inside the window.
 * @throws {RangeError} When `days` is not an integer between 1 and 30.
 */
export function summarizeDeployments(
  database: Database,
  options: { readonly days: number; readonly now?: Date },
): DeploymentStats {
  if (Number.isInteger(options.days) === false || options.days < 1 || options.days > MAX_DAYS) {
    throw new RangeError(`days must be an integer between 1 and ${MAX_DAYS}, got ${options.days}`);
  }
  const now = options.now ?? new Date();
  const dayKeys = windowDays(now, options.days);
  const rows = listWindowDeployments(database, { now, days: options.days, firstDay: dayKeys[0] });
  const byDay = countByDay(rows, dayKeys);
  const durations = rows
    .filter((row) => row.status === "succeeded")
    .map((row) => durationBetween(row.startedAt, row.finishedAt))
    .filter((duration): duration is number => duration != null && duration >= 0);

  const days = dayKeys.map((day) => {
    const counts = byDay.get(day) ?? { succeeded: 0, failed: 0, other: 0 };
    return { day, succeeded: counts.succeeded, failed: counts.failed, other: counts.other };
  });
  const succeeded = days.reduce((sum, day) => sum + day.succeeded, 0);
  const failed = days.reduce((sum, day) => sum + day.failed, 0);
  const finished = succeeded + failed;
  return {
    total: rows.length,
    succeeded,
    failed,
    cancelled: rows.filter((row) => row.status === "cancelled").length,
    successRatePercent: finished === 0 ? null : (succeeded / finished) * PERCENT,
    averageDurationInMs:
      durations.length === 0
        ? null
        : durations.reduce((sum, duration) => sum + duration, 0) / durations.length,
    days,
  };
}

type DeploymentRow = {
  readonly status: string;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
};

type DayCounts = { succeeded: number; failed: number; other: number };

function listWindowDeployments(
  database: Database,
  window: { readonly now: Date; readonly days: number; readonly firstDay: string | undefined },
): DeploymentRow[] {
  const { firstDay } = window;
  // A generous lower bound; rows from before the first local day are dropped below.
  const since = new Date(window.now.getTime() - (window.days + 1) * MILLISECONDS_PER_DAY);
  return (
    database
      .select({
        status: tables.deployments.status,
        createdAt: tables.deployments.createdAt,
        startedAt: tables.deployments.startedAt,
        finishedAt: tables.deployments.finishedAt,
      })
      .from(tables.deployments)
      // Production only: previews come and go with pull requests and would skew the figures.
      .where(
        and(
          gte(tables.deployments.createdAt, since.toISOString()),
          isNull(tables.deployments.previewId),
        ),
      )
      .all()
      .filter((row) => {
        const day = dayKey(row.createdAt);
        return day != null && firstDay != null && day >= firstDay;
      })
  );
}

function countByDay(
  rows: readonly DeploymentRow[],
  dayKeys: readonly string[],
): Map<string, DayCounts> {
  const byDay = new Map(dayKeys.map((day) => [day, { succeeded: 0, failed: 0, other: 0 }]));
  for (const row of rows) {
    const bucket = byDay.get(dayKey(row.createdAt) ?? "");
    if (bucket != null) {
      bucket[outcomeOf(row.status)] += 1;
    }
  }
  return byDay;
}

function outcomeOf(status: string): "succeeded" | "failed" | "other" {
  if (status === "succeeded" || status === "failed") {
    return status;
  }
  return "other";
}

/** The local calendar days of the window, oldest first, ending on the day of `now`. */
function windowDays(now: Date, count: number): string[] {
  const keys: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const key = dayKey(new Date(now.getTime() - offset * MILLISECONDS_PER_DAY).toISOString());
    if (key != null) {
      keys.push(key);
    }
  }
  return keys;
}
