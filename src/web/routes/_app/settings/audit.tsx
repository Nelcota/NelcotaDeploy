import { createFileRoute } from "@tanstack/react-router";

import { AdministrationPage, AuditTab } from "@/web/admin";

export const Route = createFileRoute("/_app/settings/audit")({
  head: () => ({ meta: [{ title: "Histórico de ações · Nelcota Deploy" }] }),
  component: AdministrationRoute,
});

function AdministrationRoute() {
  return (
    <AdministrationPage title="Histórico de ações" permission="audit:read">
      <AuditTab />
    </AdministrationPage>
  );
}
