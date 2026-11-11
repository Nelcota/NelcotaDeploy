import { and, desc, eq, gte, lt, max } from "drizzle-orm";

import { type Database, tables } from "@/db";

const MAX_SERIES_POINTS = 2000;

/** One host reading. Any field may be null when it could not be measured. */
export type HostSample = {
  readonly cpuPercent: number | null;
  readonly memoryUsedBytes: number | null;
  readonly memoryTotalBytes: number | null;
  readonly diskUsedBytes: number | null;
  readonly diskTotalBytes: number | null;
};

/** One container reading attributed to a project. */
export type ContainerSample = {
  readonly projectId: string;
  readonly cpuPercent: number | null;
  readonly memoryUsedBytes: number | null;
  readonly memoryTotalBytes: number | null;
};

/**
 * Adds up the samples of the containers of each project, so a project with several replicas
 * gets one point per reading, as one with a single container does.
 *
 * @param samples - One sample per container.
 * @returns One sample per project; a figure no container reported stays null.
 */
export function combineSamplesByProject(samples: readonly ContainerSample[]): ContainerSample[] {
  const byProject = Map.groupBy(samples, (sample) => sample.projectId);
  return [...byProject].map(([projectId, projectSamples]) => ({
    projectId,
    cpuPercent: sumKnown(projectSamples.map((sample) => sample.cpuPercent)),
    memoryUsedBytes: sumKnown(projectSamples.map((sample) => sample.memoryUsedBytes)),
    memoryTotalBytes: sumKnown(projectSamples.map((sample) => sample.memoryTotalBytes)),
  }));
}

function sumKnown(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value != null);
  if (known.length === 0) {
    return null;
  }
  return known.reduce((total, value) => total + value, 0);
}

/**
 * Stores a host reading.
 *
 * @param database - Database.
 * @param sample - Reading of the server `serverId`; unavailable values stay null.
 * @param now - Sample time.
 */
export function recordHostSample(
  database: Database,
  sample: HostSample & { readonly serverId: string },
  now: Date = new Date(),
): void {
  database
    .insert(tables.metricSamples)
    .values({ scope: "host", projectId: null, ...sample, createdAt: now.toISOString() })
    .run();
}

/**
 * Stores container readings in one transaction.
 *
 * @param database - Database.
 * @param readings - The `serverId` the containers run on and one of the `samples` per
 *   running project container.
 * @param now - Sample time.
 */
export function recordContainerSamples(
  database: Database,
  {
    serverId,
    samples,
  }: { readonly serverId: string; readonly samples: readonly ContainerSample[] },
  now: Date = new Date(),
): void {
  if (samples.length === 0) {
    return;
  }
  database
    .insert(tables.metricSamples)
    .values(
      samples.map((sample) => ({
        scope: "container" as const,
        serverId,
        ...sample,
        diskUsedBytes: null,
        diskTotalBytes: null,
        createdAt: now.toISOString(),
      })),
    )
    .run();
}

const sampleColumns = {
  cpuPercent: tables.metricSamples.cpuPercent,
  memoryUsedBytes: tables.metricSamples.memoryUsedBytes,
  memoryTotalBytes: tables.metricSamples.memoryTotalBytes,
  diskUsedBytes: tables.metricSamples.diskUsedBytes,
  diskTotalBytes: tables.metricSamples.diskTotalBytes,
  createdAt: tables.metricSamples.createdAt,
};

/**
 * Lists host samples of a server since a time, oldest first.
 *
 * @param database - Database.
 * @param serverId - Server id.
 * @param since - Start of the window.
 * @returns Up to 2000 samples.
 */
export function listHostSamples(database: Database, serverId: string, since: Date) {
  return database
    .select(sampleColumns)
    .from(tables.metricSamples)
    .where(
      and(
        eq(tables.metricSamples.serverId, serverId),
        eq(tables.metricSamples.scope, "host"),
        gte(tables.metricSamples.createdAt, since.toISOString()),
      ),
    )
    .orderBy(desc(tables.metricSamples.createdAt), desc(tables.metricSamples.id))
    .limit(MAX_SERIES_POINTS)
    .all()
    .toReversed();
}

/**
 * Returns the newest host sample of a server.
 *
 * @param database - Database.
 * @param serverId - Server id.
 * @returns The sample, or null when none was collected.
 */
export function getLatestHostSample(database: Database, serverId: string) {
  return (
    database
      .select(sampleColumns)
      .from(tables.metricSamples)
      .where(
        and(eq(tables.metricSamples.serverId, serverId), eq(tables.metricSamples.scope, "host")),
      )
      .orderBy(desc(tables.metricSamples.createdAt))
      .limit(1)
      .get() ?? null
  );
}

type HostSampleRow = ReturnType<typeof getLatestHostSample>;

/**
 * Returns the newest host sample of every server, in one query.
 *
 * @param database - Database.
 * @returns Samples keyed by server id; servers without samples are missing.
 */
export function listLatestHostSamples(database: Database): Map<string, NonNullable<HostSampleRow>> {
  const newest = database
    .select({
      serverId: tables.metricSamples.serverId,
      createdAt: max(tables.metricSamples.createdAt).as("newest_created_at"),
    })
    .from(tables.metricSamples)
    .where(eq(tables.metricSamples.scope, "host"))
    .groupBy(tables.metricSamples.serverId)
    .as("newest");
  const rows = database
    .select({ serverId: tables.metricSamples.serverId, ...sampleColumns })
    .from(tables.metricSamples)
    .innerJoin(
      newest,
      and(
        eq(tables.metricSamples.serverId, newest.serverId),
        eq(tables.metricSamples.createdAt, newest.createdAt),
      ),
    )
    .where(eq(tables.metricSamples.scope, "host"))
    .all();
  return new Map(rows.map(({ serverId, ...sample }) => [serverId, sample]));
}

/**
 * Lists container samples of a project since a time, oldest first.
 *
 * @param database - Database.
 * @param projectId - Project id.
 * @param since - Start of the window.
 * @returns Up to 2000 samples.
 */
export function listProjectSamples(database: Database, projectId: string, since: Date) {
  return database
    .select(sampleColumns)
    .from(tables.metricSamples)
    .where(
      and(
        eq(tables.metricSamples.scope, "container"),
        eq(tables.metricSamples.projectId, projectId),
        gte(tables.metricSamples.createdAt, since.toISOString()),
      ),
    )
    .orderBy(desc(tables.metricSamples.createdAt), desc(tables.metricSamples.id))
    .limit(MAX_SERIES_POINTS)
    .all()
    .toReversed();
}

/**
 * Deletes metric samples older than the retention window.
 *
 * @param database - Database.
 * @param before - Samples created before this time are deleted.
 */
export function pruneMetricSamples(database: Database, before: Date): void {
  database
    .delete(tables.metricSamples)
    .where(lt(tables.metricSamples.createdAt, before.toISOString()))
    .run();
}
