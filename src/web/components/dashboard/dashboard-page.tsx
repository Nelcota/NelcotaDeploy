import { useQuery } from "@tanstack/react-query";

import { ErrorState } from "@/web/components/layout/states";
import { getDashboardFn } from "@/web/functions/dashboard.functions";

import { ActivityCard } from "./activity-card";
import { ApplicationsCard } from "./applications-card";
import { REFRESH_INTERVAL_IN_MS } from "./dashboard";
import { OverviewCard } from "./overview-card";
import { ServerCard } from "./server/server-card";

/** Home page: application states, server load, recent activity and every application. */
export function DashboardPage() {
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboardFn(),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
  if (dashboard.isError) {
    return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  }
  const data = dashboard.data ?? null;
  return (
    <>
      <h1 className="sr-only">Painel</h1>
      <OverviewCard data={data} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <ServerCard />
        <ActivityCard data={data} />
      </div>
      <ApplicationsCard />
    </>
  );
}
