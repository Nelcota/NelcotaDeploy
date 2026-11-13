import { createFileRoute } from "@tanstack/react-router";

import { OrganizationTab } from "@/web/admin";
import { useCan } from "@/web/components/shell/use-permissions";

export const Route = createFileRoute("/_app/settings/alerts")({
  head: () => ({ meta: [{ title: "Alertas de deploy e servidor · Nelcota Deploy" }] }),
  component: AdministrationRoute,
});

function AdministrationRoute() {
  const can = useCan();
  return <OrganizationTab canEdit={can("settings:write")} section="alerts" />;
}
