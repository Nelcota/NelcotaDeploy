import { ClockIcon, CpuIcon, MemoryStickIcon, RotateCwIcon } from "lucide-react";

import { formatBytes, formatPercent, formatRelativeTime, formatShortTime } from "@/shared/format";
import type { Stat } from "@/web/components/layout/layout";
import type { currentContainer } from "@/web/components/projects/project-header";
import type { getProjectMetricsFn } from "@/web/functions/monitoring.functions";

export type MetricSample = Awaited<ReturnType<typeof getProjectMetricsFn>>[number];
type Container = Pick<
  NonNullable<ReturnType<typeof currentContainer>>,
  "restartCount" | "startedAt"
>;
type LatestSample = Pick<
  MetricSample,
  "createdAt" | "cpuPercent" | "memoryUsedBytes" | "memoryTotalBytes"
>;

/**
 * Tells whether the container used no CPU at all in the period.
 *
 * @param samples - Samples of the period, oldest first.
 * @returns True when there are samples and every one reads 0 % (missing readings count as 0).
 */
export function isCpuIdle(samples: readonly Pick<MetricSample, "cpuPercent">[]): boolean {
  if (samples.length === 0) {
    return false;
  }
  return samples.every((sample) => (sample.cpuPercent ?? 0) === 0);
}

function memoryLimitDetail(latest: LatestSample | null): string {
  // Docker reports the host memory as the limit when the container has none.
  if (latest?.memoryTotalBytes == null) {
    return "limite indisponível";
  }
  return `limite visto: ${formatBytes(latest.memoryTotalBytes)}`;
}

function cpuStat(latest: LatestSample | null, now: Date): Stat {
  return {
    label: "CPU agora",
    icon: CpuIcon,
    value: formatPercent(latest?.cpuPercent ?? null),
    detail: latest == null ? "sem amostras" : formatRelativeTime(latest.createdAt, now),
  };
}

function memoryStat(latest: LatestSample | null): Stat {
  return {
    label: "Memória",
    icon: MemoryStickIcon,
    value: formatBytes(latest?.memoryUsedBytes ?? null),
    detail: memoryLimitDetail(latest),
  };
}

function restartsStat(container: Container | null): Stat {
  if (container == null) {
    return { label: "Reinícios", icon: RotateCwIcon, value: "—", tone: "default" };
  }
  return {
    label: "Reinícios",
    icon: RotateCwIcon,
    value: container.restartCount,
    tone: container.restartCount > 0 ? "warning" : "default",
  };
}

function uptimeStat(container: Container | null, now: Date): Stat {
  const startedAt = container?.startedAt ?? null;
  if (startedAt == null) {
    return { label: "No ar desde", icon: ClockIcon, value: "—" };
  }
  return {
    label: "No ar desde",
    icon: ClockIcon,
    value: formatShortTime(startedAt),
    detail: formatRelativeTime(startedAt, now),
  };
}

/**
 * Builds the "now" stat row: CPU, memory, restarts and uptime of the live container.
 *
 * @param latest - Newest sample, or null when the period has none.
 * @param container - Live container, or null when the worker has not reported it.
 * @param now - Current time, for relative times.
 * @returns The four stats in display order.
 */
export function buildMetricStats({
  latest,
  container,
  now,
}: {
  readonly latest: LatestSample | null;
  readonly container: Container | null;
  readonly now: Date;
}): Stat[] {
  return [
    cpuStat(latest, now),
    memoryStat(latest),
    restartsStat(container),
    uptimeStat(container, now),
  ];
}
