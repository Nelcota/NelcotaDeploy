import { createFileRoute } from "@tanstack/react-router";

import { AdministrationPage, GitHubPage } from "@/web/admin";

export const Route = createFileRoute("/_app/settings/integrations/github")({
  head: () => ({ meta: [{ title: "Conexão com o GitHub · Nelcota Deploy" }] }),
  component: AdministrationRoute,
});

function AdministrationRoute() {
  return (
    <AdministrationPage title="Conexão com o GitHub">
      <GitHubPage />
    </AdministrationPage>
  );
}
