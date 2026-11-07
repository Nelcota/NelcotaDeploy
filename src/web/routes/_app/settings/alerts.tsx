import { createFileRoute } from "@tanstack/react-router";

import { AdministrationPage, OrganizationTab } from "@/web/admin";
import { useCan } from "@/web/components/shell/use-permissions";

export const Route = createFileRoute("/_app/settings/alerts")({
  head: () => ({ meta: [{ title: "Notificações por webhook · Nelcota Deploy" }] }),
  component: AdministrationRoute,
});

function AdministrationRoute() {
  const can = useCan();
  return (
    <AdministrationPage title="Notificações por webhook">
      <OrganizationTab canEdit={can("settings:write")} section="alerts" />
    </AdministrationPage>
  );
}
