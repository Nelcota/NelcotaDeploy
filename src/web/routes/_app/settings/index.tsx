import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { AdministrationNavigation } from "@/web/admin";
import { legacyAdministrationDestination } from "@/web/components/shell/navigation";
import { PageHeader } from "@/web/components/shell/page-header";

export const Route = createFileRoute("/_app/settings/")({
  head: () => ({ meta: [{ title: "Administração · Nelcota Deploy" }] }),
  validateSearch: z.object({
    tab: z.enum(["organization", "users", "servers", "server", "tokens", "audit"]).optional(),
  }),
  beforeLoad: ({ search, context }) => {
    if (search.tab != null) {
      throw redirect({
        to: legacyAdministrationDestination(search.tab, context.user.permissions),
        replace: true,
      });
    }
  },
  component: AdministrationOverview,
});

function AdministrationOverview() {
  return (
    <>
      <PageHeader title="Administração" />
      <AdministrationNavigation overview />
    </>
  );
}
