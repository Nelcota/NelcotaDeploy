import { createFileRoute } from "@tanstack/react-router";

import { AdministrationPage, WebhookDeliveriesSection } from "@/web/admin";

export const Route = createFileRoute("/_app/settings/webhooks")({
  head: () => ({ meta: [{ title: "Webhooks recebidos do GitHub · Nelcota Deploy" }] }),
  component: () => (
    <AdministrationPage title="Webhooks recebidos do GitHub" permission="audit:read">
      <WebhookDeliveriesSection />
    </AdministrationPage>
  ),
});
