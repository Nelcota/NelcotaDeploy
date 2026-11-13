import { createFileRoute } from "@tanstack/react-router";

import { OrganizationTab } from "@/web/admin";
import { useCan } from "@/web/components/shell/use-permissions";

export const Route = createFileRoute("/_app/settings/domains")({
  head: () => ({ meta: [{ title: "Domínios automáticos · Nelcota Deploy" }] }),
  component: AdministrationRoute,
});

function AdministrationRoute() {
  const can = useCan();
  return <OrganizationTab canEdit={can("settings:write")} section="domains" />;
}
