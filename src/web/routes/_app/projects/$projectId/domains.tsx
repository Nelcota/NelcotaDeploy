import { createFileRoute } from "@tanstack/react-router";

import { DomainsPage } from "@/web/components/domains/domains-page";

export const Route = createFileRoute("/_app/projects/$projectId/domains")({
  head: () => ({ meta: [{ title: "Domínios · Nelcota Deploy" }] }),
  component: DomainsRoute,
});

function DomainsRoute() {
  const { projectId } = Route.useParams();
  return <DomainsPage projectId={projectId} />;
}
