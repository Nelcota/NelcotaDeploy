import { createFileRoute } from "@tanstack/react-router";

import { AdministrationPage, TokensTab } from "@/web/admin";

export const Route = createFileRoute("/_app/settings/tokens")({
  head: () => ({ meta: [{ title: "Tokens de acesso à API · Nelcota Deploy" }] }),
  component: AdministrationRoute,
});

function AdministrationRoute() {
  return (
    <AdministrationPage title="Tokens de acesso à API" permission="token:manage">
      <TokensTab />
    </AdministrationPage>
  );
}
