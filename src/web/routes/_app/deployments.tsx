import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { DeploymentNavigation } from "@/web/components/deployment-history/all/deployment-navigation";
import { DeploymentsHistory } from "@/web/components/deployment-history/all/deployments-history";
import {
  ALL_STATUSES,
  STATUS_FILTERS,
  type StatusFilter,
} from "@/web/components/deployment-history/deployment-history";
import { PageHeader } from "@/web/components/shell/page-header";

export const Route = createFileRoute("/_app/deployments")({
  validateSearch: z.object({
    status: z
      .enum(STATUS_FILTERS.map(({ value }) => value))
      .optional()
      .catch(undefined),
  }),
  head: () => ({ meta: [{ title: "Histórico de deploys · Nelcota Deploy" }] }),
  component: DeploymentsPage,
});

function DeploymentsPage() {
  const status = Route.useSearch().status ?? ALL_STATUSES;
  const navigate = useNavigate({ from: Route.fullPath });
  const setStatus = (next: StatusFilter) => {
    void navigate({ search: { status: next === ALL_STATUSES ? undefined : next }, replace: true });
  };

  return (
    <>
      <PageHeader
        title="Histórico de deploys"
        description="Consulte os deploys por projeto e status."
      />
      <DeploymentNavigation />
      <DeploymentsHistory statusFilter={status} onStatusFilterChange={setStatus} />
    </>
  );
}
