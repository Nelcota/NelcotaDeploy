import { createFileRoute } from "@tanstack/react-router";

import { DeploymentNavigation } from "@/web/components/deployment-history/all/deployment-navigation";
import { DeploymentsSummary } from "@/web/components/deployment-history/all/deployments-summary";
import { PageHeader } from "@/web/components/shell/page-header";

export const Route = createFileRoute("/_app/deployment-statistics")({
  head: () => ({ meta: [{ title: "Estatísticas de deploys · Nelcota Deploy" }] }),
  component: () => (
    <>
      <PageHeader
        title="Estatísticas de deploys"
        description="Acompanhe o volume de deploys, a taxa de sucesso e o tempo de execução."
      />
      <DeploymentNavigation />
      <DeploymentsSummary />
    </>
  ),
});
