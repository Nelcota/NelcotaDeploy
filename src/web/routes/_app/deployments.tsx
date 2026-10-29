import { createFileRoute } from "@tanstack/react-router";

import { DeploymentsHistory } from "@/web/components/deployment-history/all/deployments-history";
import { DeploymentsSummary } from "@/web/components/deployment-history/all/deployments-summary";
import { PageHeader } from "@/web/components/shell/page-header";

export const Route = createFileRoute("/_app/deployments")({
  head: () => ({ meta: [{ title: "Deploys · Nelcota Deploy" }] }),
  component: DeploymentsPage,
});

function DeploymentsPage() {
  return (
    <>
      <PageHeader title="Deploys" />
      <DeploymentsSummary />
      <DeploymentsHistory />
    </>
  );
}
