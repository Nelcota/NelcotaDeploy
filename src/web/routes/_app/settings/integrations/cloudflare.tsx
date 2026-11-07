import { createFileRoute } from "@tanstack/react-router";

import { AdministrationPage, CloudflareConnection } from "@/web/admin";
import { useCan } from "@/web/components/shell/use-permissions";

export const Route = createFileRoute("/_app/settings/integrations/cloudflare")({
  head: () => ({ meta: [{ title: "Conexão com a Cloudflare · Nelcota Deploy" }] }),
  component: AdministrationRoute,
});

function AdministrationRoute() {
  const can = useCan();
  return (
    <AdministrationPage title="Conexão com a Cloudflare">
      <CloudflareConnection canEdit={can("settings:write")} />
    </AdministrationPage>
  );
}
