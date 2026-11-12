import { ErrorState } from "@/web/components/layout/states";
import { PageHeader } from "@/web/components/shell/page-header";

import { OverviewCard } from "./overview-card";
import { useDashboardSummary } from "./use-dashboard-summary";

/** Home page with one purpose: inspect application health. */
export function DashboardPage() {
  const dashboard = useDashboardSummary();
  if (dashboard.isError) {
    return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  }
  const data = dashboard.data ?? null;
  return (
    <>
      <PageHeader title="Visão geral" />
      <OverviewCard data={data} />
    </>
  );
}
