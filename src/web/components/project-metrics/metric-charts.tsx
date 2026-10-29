import { CpuIcon, MemoryStickIcon } from "lucide-react";

import { bytesToMebibytes, formatMebibytes } from "@/shared/format";
import { CardTitleRow } from "@/web/components/layout/layout";
import { MetricChart } from "@/web/components/monitoring/metric-chart";
import { Card } from "@/web/components/ui/card";

import { isCpuIdle, type MetricSample } from "./metric-stats";

const MAX_CPU_PERCENT = 100;

/** CPU and memory charts of the period, side by side on wide screens. */
export function MetricCharts({ samples }: { readonly samples: readonly MetricSample[] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="gap-5 p-5">
        <CardTitleRow icon={CpuIcon} title="CPU">
          <span className="text-xs text-muted-foreground">
            {isCpuIdle(samples) ? "ociosa no período" : "uso em %"}
          </span>
        </CardTitleRow>
        <MetricChart
          label="CPU"
          colorVariable="--chart-1"
          maxValue={MAX_CPU_PERCENT}
          formatValue={(value) => `${Math.round(value)}%`}
          points={samples.map((sample) => ({
            createdAt: sample.createdAt,
            value: sample.cpuPercent,
          }))}
        />
      </Card>
      <Card className="gap-5 p-5">
        <CardTitleRow icon={MemoryStickIcon} title="Memória">
          <span className="text-xs text-muted-foreground">em uso</span>
        </CardTitleRow>
        <MetricChart
          label="Memória"
          colorVariable="--chart-2"
          formatValue={formatMebibytes}
          points={samples.map((sample) => ({
            createdAt: sample.createdAt,
            value: bytesToMebibytes(sample.memoryUsedBytes),
          }))}
        />
      </Card>
    </div>
  );
}
