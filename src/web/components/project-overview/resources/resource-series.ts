import { bytesToMebibytes, formatBytes, formatMebibytes, formatPercent } from "@/shared/format";

const HOURS_PER_DAY = 24;
const MAX_CPU_PERCENT = 100;

export const RESOURCE_WINDOWS = [
  { value: 1, label: "Última hora" },
  { value: HOURS_PER_DAY, label: "24 horas" },
] as const;

export const RESOURCE_SERIES = [
  { value: "cpu", label: "CPU", color: "--chart-1" },
  { value: "memory", label: "Memória", color: "--chart-2" },
] as const;

export type ResourceSeries = (typeof RESOURCE_SERIES)[number]["value"];

export type ResourceSample = {
  readonly createdAt: string;
  readonly cpuPercent: number | null;
  readonly memoryUsedBytes: number | null;
};

/**
 * Formats the newest sample of the chosen series, or "—" when there is no sample yet.
 *
 * @param series - Which resource is on screen.
 * @param latest - Newest sample, or null when none was collected.
 * @returns The value as shown beside "Agora".
 */
export function formatCurrentResource(
  series: ResourceSeries,
  latest: ResourceSample | null,
): string {
  if (latest == null) {
    return "—";
  }
  if (series === "cpu") {
    return formatPercent(latest.cpuPercent);
  }
  return formatBytes(latest.memoryUsedBytes);
}

/**
 * Builds the chart settings for a series: its points, value format and fixed ceiling.
 *
 * @param series - Which resource is on screen.
 * @param samples - Samples in chronological order.
 * @returns CPU in percent (capped at 100) or memory in mebibytes.
 */
export function resourceChart(series: ResourceSeries, samples: readonly ResourceSample[]) {
  if (series === "cpu") {
    return {
      maxValue: MAX_CPU_PERCENT,
      formatValue: (value: number) => `${Math.round(value)}%`,
      points: samples.map((sample) => ({ createdAt: sample.createdAt, value: sample.cpuPercent })),
    };
  }
  return {
    formatValue: formatMebibytes,
    points: samples.map((sample) => ({
      createdAt: sample.createdAt,
      value: bytesToMebibytes(sample.memoryUsedBytes),
    })),
  };
}
