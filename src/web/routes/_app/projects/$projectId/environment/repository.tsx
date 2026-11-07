import { createFileRoute } from "@tanstack/react-router";

import { EnvironmentImportPage } from "@/web/components/environment/repository/environment-import-page";

export const Route = createFileRoute("/_app/projects/$projectId/environment/repository")({
  head: () => ({ meta: [{ title: "Importar variáveis do repositório · Nelcota Deploy" }] }),
  component: PageRoute,
});

function PageRoute() {
  const { projectId } = Route.useParams();
  return <EnvironmentImportPage projectId={projectId} source="repository" />;
}
