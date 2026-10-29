import { CpuIcon, HardDriveIcon, MemoryStickIcon, ServerIcon } from "lucide-react";

import { formatBytes, formatRelativeTime } from "@/shared/format";
import { useNow } from "@/web/components/clock/use-now";
import { Section, StatRow } from "@/web/components/layout/layout";
import { usagePercent } from "@/web/components/monitoring/usage-meter";

import type { ServerData } from "./server-data";
import { formatPercent, usageTone } from "./usage-tone";

type HostSample = ServerData["hostSample"];

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

/** CPU, memory and disk usage of the latest host sample. */
export function HostUsageSection({ host }: { readonly host: HostSample }) {
  const now = useNow();
  return (
    <Section
      icon={ServerIcon}
      title="Servidor (VPS)"
      description={
        host == null
          ? "Nenhuma amostra coletada ainda."
          : `Última amostra ${formatRelativeTime(host.createdAt, now)}.`
      }
    >
      <StatRow stats={hostStats(host)} />
    </Section>
  );
}
