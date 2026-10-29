import { ServerIcon } from "lucide-react";
import { useState } from "react";

import { CardTitleRow } from "@/web/components/layout/layout";
import { SegmentedControl } from "@/web/components/layout/overview";
import { ErrorState } from "@/web/components/layout/states";
import { Card } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";

import type { HostSeries } from "../dashboard";
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

/** CPU or memory of the server over the last hour or day. */
export function ServerCard() {
  const [hours, setHours] = useState<number>(1);
  const [series, setSeries] = useState<HostSeries>("cpu");
  const hostMetrics = useHostMetrics(hours);
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
      {hostMetrics.isPending ? <Skeleton className="h-64 rounded-lg" /> : null}
      {hostMetrics.data == null ? null : <HostChart samples={samples} series={series} />}
    </Card>
  );
}
