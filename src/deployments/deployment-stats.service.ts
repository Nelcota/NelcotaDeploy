import { and, count, gte, isNull, lt, sql } from "drizzle-orm";

import { type Database, tables } from "@/db";
import { dayKey } from "@/shared/format";

const MILLISECONDS_PER_DAY = 86_400_000;
const MAX_DAYS = 30;
const PERCENT = 100;

type DeploymentDay = {
  readonly day: string;
  readonly succeeded: number;
  readonly failed: number;
  readonly other: number;
};

/** Production deployments grouped by São Paulo calendar day, including empty days. */
export type DeploymentStats = {
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly successRatePercent: number | null;
  readonly averageDurationInMs: number | null;
  readonly days: readonly DeploymentDay[];
};

/** Finds the first UTC millisecond of a local day, including midnight DST transitions. */
function startOfDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid statistics day: ${day}`);
  }
  let lower = date.getTime() - MILLISECONDS_PER_DAY;
  let upper = date.getTime() + MILLISECONDS_PER_DAY;
  while (lower < upper) {
    const middle = Math.floor(lower + (upper - lower) / 2);
    const localDay = dayKey(new Date(middle).toISOString());
    if (localDay == null) {
      throw new RangeError(`Cannot determine statistics day: ${day}`);
    }
    if (localDay < day) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  return new Date(lower).toISOString();
}

function windowDays(now: Date, days: number) {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("Invalid statistics reference date");
  }
  const today = dayKey(now.toISOString());
  if (today == null) {
    throw new RangeError("Cannot determine statistics reference day");
  }
  const reference = new Date(`${today}T12:00:00.000Z`).getTime();
  const boundaries = Array.from({ length: days + 1 }, (_, index) => {
    const day = new Date(reference - (days - index - 1) * MILLISECONDS_PER_DAY)
      .toISOString()
      .slice(0, 10);
    return { day, start: startOfDay(day) };
  });
  return boundaries.slice(0, -1).map((boundary, index) => {
    const next = boundaries.at(index + 1);
    if (next == null) {
      throw new Error(`Missing statistics boundary after ${boundary.day}`);
    }
    return { day: boundary.day, start: boundary.start, end: next.start };
  });
}

type DayWindow = ReturnType<typeof windowDays>[number];

function aggregateDays(database: Database, windows: readonly DayWindow[]) {
  const first = windows.at(0);
  const last = windows.at(-1);
  if (first == null || last == null) {
    throw new Error("Statistics window has no calendar days");
  }
  const day = sql<string>`CASE ${sql.join(
    windows.map(
      (window) => sql`
    WHEN ${tables.deployments.createdAt} >= ${window.start}
      AND ${tables.deployments.createdAt} < ${window.end} THEN ${window.day}
  `,
    ),
    sql` `,
  )} END`;
  const duration = sql`ROUND((julianday(${tables.deployments.finishedAt}) - julianday(${tables.deployments.startedAt})) * ${MILLISECONDS_PER_DAY})`;
  const validDuration = sql`CASE WHEN ${tables.deployments.status} = 'succeeded' AND ${duration} >= 0 THEN ${duration} END`;
  return database
    .select({
      day,
      total: count(),
      succeeded: sql<number>`SUM(${tables.deployments.status} = 'succeeded')`.mapWith(Number),
      failed: sql<number>`SUM(${tables.deployments.status} = 'failed')`.mapWith(Number),
      cancelled: sql<number>`SUM(${tables.deployments.status} = 'cancelled')`.mapWith(Number),
      durationSum: sql<number>`COALESCE(SUM(${validDuration}), 0)`.mapWith(Number),
      durationCount: sql<number>`COUNT(${validDuration})`.mapWith(Number),
    })
    .from(tables.deployments)
    .where(
      and(
        gte(tables.deployments.createdAt, first.start),
        lt(tables.deployments.createdAt, last.end),
        isNull(tables.deployments.previewId),
      ),
    )
    .groupBy(day)
    .all();
}

/** Aggregates in SQLite, transferring at most one row per requested calendar day. */
export function summarizeDeployments(
  database: Database,
  options: { readonly days: number; readonly now?: Date },
): DeploymentStats {
  if (Number.isInteger(options.days) === false || options.days < 1 || options.days > MAX_DAYS) {
    throw new RangeError(`days must be an integer between 1 and ${MAX_DAYS}, got ${options.days}`);
  }
  const windows = windowDays(options.now ?? new Date(), options.days);
  const rows = aggregateDays(database, windows);
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const totals = {
    total: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    durationSum: 0,
    durationCount: 0,
  };
  for (const row of rows) {
    totals.total += row.total;
    totals.succeeded += row.succeeded;
    totals.failed += row.failed;
    totals.cancelled += row.cancelled;
    totals.durationSum += row.durationSum;
    totals.durationCount += row.durationCount;
  }
  const finished = totals.succeeded + totals.failed;
  const successRatePercent = finished === 0 ? null : (totals.succeeded / finished) * PERCENT;
  const averageDurationInMs =
    totals.durationCount === 0 ? null : totals.durationSum / totals.durationCount;
  if (
    Number.isFinite(successRatePercent ?? 0) === false ||
    Number.isFinite(averageDurationInMs ?? 0) === false
  ) {
    throw new Error("Deployment statistics produced non-finite aggregates");
  }
  return {
    total: totals.total,
    succeeded: totals.succeeded,
    failed: totals.failed,
    cancelled: totals.cancelled,
    successRatePercent,
    averageDurationInMs,
    days: windows.map((window) => {
      const row = byDay.get(window.day);
      return {
        day: window.day,
        succeeded: row?.succeeded ?? 0,
        failed: row?.failed ?? 0,
        other: (row?.total ?? 0) - (row?.succeeded ?? 0) - (row?.failed ?? 0),
      };
    }),
  };
}
