import { CpuIcon, HardDriveIcon, MemoryStickIcon } from "lucide-react";

import { formatBytes } from "@/shared/format";
import { StatRow } from "@/web/components/layout/layout";
import { usagePercent } from "@/web/components/monitoring/usage-meter";

import { formatPercent, usageTone } from "./usage-tone";
import type { ServerView } from "./use-servers";

type HostSample = ServerView["hostSample"];

function usageDetails(host: HostSample) {
  if (host == null) {
    return { memory: undefined, disk: undefined };
  }
  return {
    memory: `${formatBytes(host.memoryUsedBytes)} de ${formatBytes(host.memoryTotalBytes)}`,
    disk: `${formatBytes(host.diskUsedBytes)} de ${formatBytes(host.diskTotalBytes)}`,
  };
}

function hostStats(host: HostSample) {
  const cpuPercent = host?.cpuPercent ?? null;
  const memoryPercent = usagePercent(host?.memoryUsedBytes, host?.memoryTotalBytes);
  const diskPercent = usagePercent(host?.diskUsedBytes, host?.diskTotalBytes);
  const details = usageDetails(host);
  return [
    { label: "CPU", icon: CpuIcon, value: formatPercent(cpuPercent), tone: usageTone(cpuPercent) },
    {
      label: "Memória",
      icon: MemoryStickIcon,
      value: formatPercent(memoryPercent),
      tone: usageTone(memoryPercent),
      detail: details.memory,
    },
    {
      label: "Disco",
      icon: HardDriveIcon,
      value: formatPercent(diskPercent),
      tone: usageTone(diskPercent),
      detail: details.disk,
    },
  ];
}

/** CPU, memory and disk usage of a server's latest sample. */
export function ServerUsage({ host }: { readonly host: HostSample }) {
  return <StatRow stats={hostStats(host)} />;
}
