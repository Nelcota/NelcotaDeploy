import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { AdministrationOverview } from "@/web/admin";
import { legacyAdministrationDestination } from "@/web/components/shell/navigation";

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
