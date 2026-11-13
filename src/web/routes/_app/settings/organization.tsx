import { createFileRoute } from "@tanstack/react-router";

import { OrganizationTab } from "@/web/admin";
import { useCan } from "@/web/components/shell/use-permissions";

export const Route = createFileRoute("/_app/settings/organization")({
  head: () => ({ meta: [{ title: "Organização e segurança · Nelcota Deploy" }] }),
  component: AdministrationRoute,
});

function AdministrationRoute() {
  const can = useCan();
  return <OrganizationTab canEdit={can("settings:write")} section="organization" />;
}
