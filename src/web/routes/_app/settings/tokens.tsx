import { createFileRoute } from "@tanstack/react-router";

import { TokensTab } from "@/web/admin";

export const Route = createFileRoute("/_app/settings/tokens")({
  head: () => ({ meta: [{ title: "Tokens de acesso à API · Nelcota Deploy" }] }),
  component: TokensTab,
});
