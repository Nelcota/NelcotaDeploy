import { ErrorState } from "@/web/components/layout/states";
import { PageHeader } from "@/web/components/shell/page-header";

import { ActivityCard } from "./activity-card";
import { DeploymentActivitySummary } from "./overview-card";
import { useDashboardSummary } from "./use-dashboard-summary";

/** Tracks recent deployment activity and failures across projects. */
export function ActivityPage() {
  const activity = useDashboardSummary();
  if (activity.isError) {
    return <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />;
  }
  return (
    <>
      <PageHeader title="Deploys recentes" />
      <DeploymentActivitySummary data={activity.data ?? null} />
      <ActivityCard data={activity.data ?? null} />
    </>
  );
}
