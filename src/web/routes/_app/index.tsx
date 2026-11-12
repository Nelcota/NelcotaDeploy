import { createFileRoute } from "@tanstack/react-router";

import { DashboardPage } from "@/web/components/dashboard/dashboard-page";

export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "Visão geral · Nelcota Deploy" }] }),
  component: DashboardPage,
});
