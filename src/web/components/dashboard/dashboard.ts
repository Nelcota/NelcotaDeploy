import { usagePercent } from "@/web/components/monitoring/usage-meter";
import type { getDashboardFn, getHostMetricsFn } from "@/web/functions/dashboard.functions";

/** Every dashboard card refreshes this often. */
export const REFRESH_INTERVAL_IN_MS = 10_000;

export type DashboardSummary = NonNullable<Awaited<ReturnType<typeof getDashboardFn>>>;
export type HostSample = Awaited<ReturnType<typeof getHostMetricsFn>>[number];
export type HostSeries = "cpu" | "memory";

/**
 * Reads the chosen series from one host sample.
 *
 * @param sample - CPU and memory reading of the server.
 * @param series - Which value to read.
 * @returns CPU use, or memory use as a share of the total, in percent; null when unknown.
 */
export function hostSeriesValue(
  sample: Pick<HostSample, "cpuPercent" | "memoryUsedBytes" | "memoryTotalBytes"> | undefined,
  series: HostSeries,
): number | null {
  if (series === "cpu") {
    return sample?.cpuPercent ?? null;
  }
  return usagePercent(sample?.memoryUsedBytes, sample?.memoryTotalBytes);
}

/** What the dashboard needs to pick which server's chart to show first. */
type ChartServer = {
  readonly id: string;
  readonly status: "pending" | "ready" | "unreachable";
  readonly acceptsApplications: boolean;
};

/**
 * Picks the server whose chart opens first: one that runs applications and is connected.
 *
 * @param servers - Servers, the panel's own first.
 * @returns Server id, or null when there are none.
 */
export function defaultChartServerId(servers: readonly ChartServer[]): string | null {
  const preferred =
    servers.find((server) => server.acceptsApplications && server.status === "ready") ??
    servers.find((server) => server.acceptsApplications) ??
    servers[0];
  return preferred?.id ?? null;
}
