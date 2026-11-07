import { createFileRoute } from "@tanstack/react-router";

import { AdministrationPage, UsersTab } from "@/web/admin";

export const Route = createFileRoute("/_app/settings/users")({
  head: () => ({ meta: [{ title: "Usuários · Nelcota Deploy" }] }),
  component: AdministrationRoute,
});

function AdministrationRoute() {
  return (
    <AdministrationPage title="Usuários" permission="user:manage">
      <UsersTab />
    </AdministrationPage>
  );
}
