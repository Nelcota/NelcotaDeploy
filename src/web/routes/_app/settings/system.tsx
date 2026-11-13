import { createFileRoute } from "@tanstack/react-router";

import { ServerTab } from "@/web/admin";

export const Route = createFileRoute("/_app/settings/system")({
  head: () => ({ meta: [{ title: "Estado do sistema · Nelcota Deploy" }] }),
  component: ServerTab,
});
