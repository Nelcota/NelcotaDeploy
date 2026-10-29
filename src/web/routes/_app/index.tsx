import { createFileRoute } from "@tanstack/react-router";

import { DashboardPage } from "@/web/components/dashboard/dashboard-page";

export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "Painel · Nelcota Deploy" }] }),
  component: DashboardPage,
});
