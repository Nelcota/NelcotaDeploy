import { DeploymentNavigation } from "@/web/components/deployment-history/all/deployment-navigation";
import { ErrorState } from "@/web/components/layout/states";
import { PageHeader } from "@/web/components/shell/page-header";

import { ActivityCard } from "./activity-card";
import { DeploymentActivitySummary } from "./overview-card";
import { useDashboardSummary } from "./use-dashboard-summary";

/** Tracks recent deployment activity and failures across projects. */
export function ActivityPage() {
  const activity = useDashboardSummary();
  return (
    <>
      <PageHeader
        title="Deploys recentes"
        description="Acompanhe as publicações mais recentes e as falhas das últimas 24 horas."
      />
      <DeploymentNavigation />
      {activity.isError ? (
        <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />
      ) : (
        <>
          <DeploymentActivitySummary data={activity.data ?? null} />
          <ActivityCard data={activity.data ?? null} />
        </>
      )}
    </>
  );
}
