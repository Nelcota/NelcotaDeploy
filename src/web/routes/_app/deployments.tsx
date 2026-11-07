import { createFileRoute } from "@tanstack/react-router";

import { DeploymentsHistory } from "@/web/components/deployment-history/all/deployments-history";
import { PageHeader } from "@/web/components/shell/page-header";

export const Route = createFileRoute("/_app/deployments")({
  head: () => ({ meta: [{ title: "Histórico de deploys · Nelcota Deploy" }] }),
  component: DeploymentsPage,
});

function DeploymentsPage() {
  return (
    <>
      <PageHeader title="Histórico de deploys" />
      <DeploymentsHistory />
    </>
  );
}
