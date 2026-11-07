import { createFileRoute } from "@tanstack/react-router";

import { ProjectDnsPage } from "@/web/components/domains/dns/dns-page";

export const Route = createFileRoute("/_app/projects/$projectId/(resources)/dns")({
  head: () => ({ meta: [{ title: "Registros DNS dos domínios · Nelcota Deploy" }] }),
  component: PageRoute,
});

function PageRoute() {
  const { projectId } = Route.useParams();
  return <ProjectDnsPage projectId={projectId} />;
}
