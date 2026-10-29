import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ActivityIcon } from "lucide-react";
import { useState } from "react";

import { CardTitleRow, TEXT_LINK } from "@/web/components/layout/layout";
import { SegmentedControl } from "@/web/components/layout/overview";
import { Card } from "@/web/components/ui/card";
import { getProjectMetricsFn } from "@/web/functions/monitoring.functions";

import { ResourceChart } from "./resource-chart";
import {
  formatCurrentResource,
  RESOURCE_SERIES,
  RESOURCE_WINDOWS,
  type ResourceSeries,
} from "./resource-series";

const METRICS_POLL_INTERVAL_IN_MS = 30_000;
const SERIES_OPTIONS = RESOURCE_SERIES.map((item) => ({ value: item.value, label: item.label }));

/** CPU or memory of the running container over the last hour or day. */
export function ResourcesCard({ projectId }: { readonly projectId: string }) {
  const [hours, setHours] = useState<number>(1);
  const [series, setSeries] = useState<ResourceSeries>("cpu");
  const metrics = useQuery({
    queryKey: ["project-metrics", projectId, hours],
    queryFn: () => getProjectMetricsFn({ data: { projectId, hours } }),
    refetchInterval: METRICS_POLL_INTERVAL_IN_MS,
  });
  const latest = metrics.data?.at(-1) ?? null;
  return (
    <Card className="h-full gap-5 p-5">
      <CardTitleRow icon={ActivityIcon} title="Recursos">
        <SegmentedControl
          label="Janela de tempo"
          options={RESOURCE_WINDOWS}
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
        <p className="text-sm text-muted-foreground">
          Agora{" "}
          <span className="font-medium text-foreground tabular-nums">
            {formatCurrentResource(series, latest)}
          </span>
          {" · "}
          <Link to="/projects/$projectId/metrics" params={{ projectId }} className={TEXT_LINK}>
            Ver métricas
          </Link>
        </p>
      </div>
      <ResourceChart series={series} samples={metrics.data ?? null} />
    </Card>
  );
}
