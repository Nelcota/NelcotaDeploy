import { createFileRoute } from "@tanstack/react-router";

import { ActivityPage } from "@/web/components/dashboard/activity-page";

export const Route = createFileRoute("/_app/activity")({
  head: () => ({ meta: [{ title: "Deploys recentes · Nelcota Deploy" }] }),
  component: ActivityPage,
});
