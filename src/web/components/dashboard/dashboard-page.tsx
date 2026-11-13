import { CircleCheckIcon } from "lucide-react";

import { HttpsRecoveryCard } from "@/web/components/domains/dns/https-recovery-card";
import { ErrorState } from "@/web/components/layout/states";
import { PageHeader } from "@/web/components/shell/page-header";
import { Card } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";

import { DashboardPriorities } from "./dashboard-priorities";
import { DashboardHttpsIssues } from "./https/dashboard-https-issues";
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
      {data == null || data.httpsIssueCount === 0 ? null : <DashboardHttpsIssues data={data} />}
      {data == null ? (
        <Skeleton className="h-36 rounded-xl" />
      ) : (
        <DashboardPriorities data={data} />
      )}
      {data == null || data.httpsRecoveries.length === 0 ? null : (
        <Card className="min-w-0 gap-3 p-3">
          <h2 className="flex items-center gap-2 px-1 text-base font-semibold">
            <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-success" />
            HTTPS restabelecido
          </h2>
          <ul role="list" className="grid gap-2 sm:grid-cols-2">
            {data.httpsRecoveries.map((recovery) => (
              <li key={`${recovery.projectId}:${recovery.hostname}`} className="min-w-0">
                <HttpsRecoveryCard {...recovery} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <OverviewCard data={data} />
    </>
  );
}
