import { ServerIcon } from "lucide-react";
import { useState } from "react";

import { useServers } from "@/web/admin";
import { CardTitleRow } from "@/web/components/layout/layout";
import { SegmentedControl } from "@/web/components/layout/overview";
import { ErrorState } from "@/web/components/layout/states";
import { Card } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";

import { defaultChartServerId, type HostSeries } from "../dashboard";
import { CurrentReading, HostChart, useHostMetrics } from "./host-chart";

const HOURS_PER_DAY = 24;
const WINDOWS = [
  { value: 1, label: "Última hora" },
  { value: HOURS_PER_DAY, label: "24 horas" },
] as const;
const SERIES_OPTIONS = [
  { value: "cpu", label: "CPU" },
  { value: "memory", label: "Memória" },
] as const satisfies readonly { readonly value: HostSeries; readonly label: string }[];

/** Picks the server to chart; the choice shows only when there is more than one. */
function useChartServer() {
  const servers = useServers().data?.servers ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const serverId = servers.some((server) => server.id === chosen)
    ? chosen
    : defaultChartServerId(servers);
  const options = servers.map((server) => ({ value: server.id, label: server.name }));
  return { serverId, options, choose: setChosen };
}

/** CPU or memory of a server over the last hour or day. */
export function ServerCard() {
  const [hours, setHours] = useState<number>(1);
  const [series, setSeries] = useState<HostSeries>("cpu");
  const server = useChartServer();
  const hostMetrics = useHostMetrics(server.serverId, hours);
  const samples = hostMetrics.data ?? [];
  return (
    <Card className="gap-5 p-5">
      <CardTitleRow icon={ServerIcon} title="Servidor">
        <SegmentedControl
          label="Janela de tempo"
          options={WINDOWS}
          value={hours}
          onChange={setHours}
        />
      </CardTitleRow>
      {server.options.length > 1 && server.serverId != null ? (
        <SegmentedControl
          label="Servidor"
          options={server.options}
          value={server.serverId}
          onChange={server.choose}
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Série"
          options={SERIES_OPTIONS}
          value={series}
          onChange={setSeries}
        />
        <CurrentReading samples={samples} series={series} />
      </div>
      {hostMetrics.isError ? (
        <ErrorState error={hostMetrics.error} onRetry={() => void hostMetrics.refetch()} />
      ) : null}
      {hostMetrics.isPending && server.serverId != null ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : null}
      {hostMetrics.data == null ? null : <HostChart samples={samples} series={series} />}
    </Card>
  );
}
