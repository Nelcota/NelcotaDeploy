import { createFileRoute } from "@tanstack/react-router";

import { AdministrationPage, ServerTab } from "@/web/admin";

export const Route = createFileRoute("/_app/settings/system")({
  head: () => ({ meta: [{ title: "Estado do sistema · Nelcota Deploy" }] }),
  component: AdministrationRoute,
});

function AdministrationRoute() {
  return (
    <AdministrationPage title="Estado do sistema">
      <ServerTab />
    </AdministrationPage>
  );
}
