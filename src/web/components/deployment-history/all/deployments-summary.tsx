import { useQuery } from "@tanstack/react-query";
import { BarChart3Icon, CalendarDaysIcon } from "lucide-react";

import { DeploymentsChart } from "@/web/components/deployments/deployments-chart";
import { CardTitleRow, StatRow } from "@/web/components/layout/layout";
import { ErrorState } from "@/web/components/layout/states";
import { Card } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";
import { getDeploymentStatsFn } from "@/web/functions/deployments.functions";

import { summaryStats } from "./summary-stats";

const STATS_REFRESH_INTERVAL_IN_MS = 30_000;
const STATS_DAYS = 7;
const SUMMARY_GRID = "grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]";

/** The last seven days of every project: key figures and deploys per day. */
export function DeploymentsSummary() {
  const stats = useQuery({
    queryKey: ["deployment-stats", STATS_DAYS],
    queryFn: () => getDeploymentStatsFn({ data: { days: STATS_DAYS } }),
    refetchInterval: STATS_REFRESH_INTERVAL_IN_MS,
  });
  if (stats.isError) {
    return <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />;
  }
  if (stats.data == null) {
    return (
      <div className={SUMMARY_GRID}>
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  return (
    <div className={SUMMARY_GRID}>
      {/* Beside the chart the tiles only have half the width, so they wrap two per row. */}
      <StatRow
        title="Últimos 7 dias"
        icon={CalendarDaysIcon}
        stats={summaryStats(stats.data)}
        className="xl:[&_dl]:grid-cols-2"
      />
      <Card className="gap-4 p-5">
        <CardTitleRow icon={BarChart3Icon} title="Deploys por dia" />
        <DeploymentsChart days={stats.data.days} />
      </Card>
    </div>
  );
}
