import { createFileRoute } from "@tanstack/react-router";

import { AdministrationPage, OrganizationTab } from "@/web/admin";
import { useCan } from "@/web/components/shell/use-permissions";

export const Route = createFileRoute("/_app/settings/organization")({
  head: () => ({ meta: [{ title: "Nome da organização · Nelcota Deploy" }] }),
  component: AdministrationRoute,
});

function AdministrationRoute() {
  const can = useCan();
  return (
    <AdministrationPage title="Nome da organização">
      <OrganizationTab canEdit={can("settings:write")} section="organization" />
    </AdministrationPage>
  );
}
