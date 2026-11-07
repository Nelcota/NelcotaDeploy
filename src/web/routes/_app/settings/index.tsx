import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { legacyAdministrationDestination } from "@/web/components/shell/navigation";

export const Route = createFileRoute("/_app/settings/")({
  validateSearch: z.object({
    tab: z.enum(["organization", "users", "servers", "server", "tokens", "audit"]).optional(),
  }),
  beforeLoad: ({ search, context }) => {
    throw redirect({
      to: legacyAdministrationDestination(search.tab, context.user.permissions),
      replace: true,
    });
  },
});
