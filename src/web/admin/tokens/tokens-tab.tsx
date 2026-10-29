import { KeyRoundIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Section } from "@/web/components/layout/layout";
import { Button } from "@/web/components/ui/button";

import { CreateTokenDialog } from "./create-token-dialog";
import { CreatedTokenDialog } from "./created-token-dialog";
import { TokenList } from "./token-list";

/** API tokens for the MCP server: create, list and revoke. */
export function TokensTab() {
  const [createOpen, setCreateOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  return (
    <Section
      icon={KeyRoundIcon}
      title="Tokens de API"
      description="Usados pelo servidor MCP. Dê a cada cliente o menor escopo possível; só o hash do token é guardado."
      action={
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon aria-hidden />
          Novo token
        </Button>
      }
    >
      <TokenList />
      {/* Mounted only while open, so a cancelled draft starts clean next time. */}
      {createOpen ? (
        <CreateTokenDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(token) => {
            setCreateOpen(false);
            setCreatedToken(token);
          }}
        />
      ) : null}
      <CreatedTokenDialog token={createdToken} onClose={() => setCreatedToken(null)} />
    </Section>
  );
}
