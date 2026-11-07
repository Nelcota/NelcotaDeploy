import { createFileRoute } from "@tanstack/react-router";

import { AdministrationPage, ServersTab } from "@/web/admin";
import { useCan } from "@/web/components/shell/use-permissions";

export const Route = createFileRoute("/_app/settings/servers")({
  head: () => ({ meta: [{ title: "Servidores de deploy · Nelcota Deploy" }] }),
  component: AdministrationRoute,
});

function AdministrationRoute() {
  const can = useCan();
  return (
    <AdministrationPage title="Servidores de deploy">
      <ServersTab canEdit={can("settings:write")} />
    </AdministrationPage>
  );
}
