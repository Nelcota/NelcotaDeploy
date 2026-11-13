import { createFileRoute } from "@tanstack/react-router";

import { UsersTab } from "@/web/admin";

export const Route = createFileRoute("/_app/settings/users")({
  head: () => ({ meta: [{ title: "Usuários e permissões · Nelcota Deploy" }] }),
  component: UsersTab,
});
