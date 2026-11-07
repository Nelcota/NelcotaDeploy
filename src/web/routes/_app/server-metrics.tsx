import { createFileRoute } from "@tanstack/react-router";

import { ServerCard } from "@/web/components/dashboard/server/server-card";
import { PageHeader } from "@/web/components/shell/page-header";

export const Route = createFileRoute("/_app/server-metrics")({
  head: () => ({ meta: [{ title: "Uso de recursos dos servidores · Nelcota Deploy" }] }),
  component: () => (
    <>
      <PageHeader title="Uso de recursos dos servidores" />
      <ServerCard />
    </>
  ),
});
