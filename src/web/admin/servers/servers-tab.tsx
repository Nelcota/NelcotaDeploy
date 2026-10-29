import { PlusIcon, ServerIcon } from "lucide-react";
import { useState } from "react";

import { Section } from "@/web/components/layout/layout";
import { ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { Button } from "@/web/components/ui/button";

import { AddServerDialog } from "./add/add-server-dialog";
import { ServerCard } from "./server-card";
import { useServers } from "./use-servers";

const SKELETON_ROWS = 2;

function ServerList({ canEdit }: { readonly canEdit: boolean }) {
  const servers = useServers();
  if (servers.isError) {
    return <ErrorState error={servers.error} onRetry={() => void servers.refetch()} />;
  }
  if (servers.data == null) {
    return <ListSkeleton rows={SKELETON_ROWS} />;
  }
  return (
    <div className="space-y-4">
      {servers.data.keyReady ? null : (
        <p role="status" className="text-sm text-warning">
          O worker ainda não iniciou, então o comando de instalação ainda não está disponível.
        </p>
      )}
      {servers.data.servers.map((server) => (
        <ServerCard key={server.id} server={server} canEdit={canEdit} />
      ))}
    </div>
  );
}

/** The VPSs applications run on: the panel's own and any added over SSH. */
export function ServersTab({ canEdit }: { readonly canEdit: boolean }) {
  const [addOpen, setAddOpen] = useState(false);
  return (
    <Section
      icon={ServerIcon}
      title="Servidores"
      description="Adicione outra VPS para separar as aplicações do painel. O painel instala o proxy com HTTPS, faz o build e o deploy lá pela própria conexão SSH."
      action={
        canEdit ? (
          <Button onClick={() => setAddOpen(true)}>
            <PlusIcon aria-hidden />
            Adicionar servidor
          </Button>
        ) : null
      }
    >
      <ServerList canEdit={canEdit} />
      {/* Mounted only while open, so a cancelled draft starts clean next time. */}
      {addOpen ? <AddServerDialog onClose={() => setAddOpen(false)} /> : null}
    </Section>
  );
}
