import { createFileRoute } from "@tanstack/react-router";

import { AuditTab } from "@/web/admin";

export const Route = createFileRoute("/_app/settings/audit")({
  head: () => ({ meta: [{ title: "Histórico de ações · Nelcota Deploy" }] }),
  component: AuditTab,
});
