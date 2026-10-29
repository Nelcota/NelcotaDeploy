import { useQuery } from "@tanstack/react-query";
import { ServerIcon } from "lucide-react";

import { CopyButton } from "@/web/components/layout/copy-button";
import { CardTitleRow } from "@/web/components/layout/layout";
import { Card } from "@/web/components/ui/card";
import { getServerAddressFn } from "@/web/functions/servers/server-address.functions";

import { dnsRecordType } from "./domains";

// The server's address rarely changes; asking once per visit (ten minutes) is enough.
const SERVER_ADDRESS_STALE_IN_MS = 600_000;

/** The DNS record a custom domain needs, pointing at the automatic hostname when there is one. */
export function DnsCard({
  projectId,
  automaticHostname,
}: {
  readonly projectId: string;
  readonly automaticHostname: string | null;
}) {
  const serverAddressQuery = useQuery({
    queryKey: ["server-address", projectId],
    queryFn: () => getServerAddressFn({ data: { projectId } }),
    staleTime: SERVER_ADDRESS_STALE_IN_MS,
  });
  // Public IP of the server the project runs on, when it is known.
  const serverAddress = serverAddressQuery.data ?? null;
  return (
    <Card className="gap-4 p-5">
      <CardTitleRow icon={ServerIcon} title="Configurar DNS" />
      <p className="text-sm text-muted-foreground">
        Crie este registro no provedor do domínio. O HTTPS sai sozinho quando o DNS responder.
      </p>
      <dl className="grid gap-x-8 gap-y-4 rounded-lg p-4 ring-1 ring-border/70 sm:grid-cols-[auto_auto_minmax(0,1fr)] sm:items-start">
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">Tipo</dt>
          <dd className="font-mono text-sm">{dnsRecordType(automaticHostname)}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">Nome</dt>
          <dd className="text-sm">o subdomínio, como app</dd>
        </div>
        <div className="min-w-0 space-y-1">
          <dt className="text-xs text-muted-foreground">Valor</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <DnsRecordValue automaticHostname={automaticHostname} serverAddress={serverAddress} />
          </dd>
        </div>
      </dl>
      {automaticHostname == null ? null : (
        <p className="text-xs text-faint">
          Na raiz do domínio, use um registro A
          {serverAddress == null ? " com o IP do servidor" : ` para ${serverAddress}`}.
        </p>
      )}
    </Card>
  );
}

function DnsRecordValue({
  automaticHostname,
  serverAddress,
}: {
  readonly automaticHostname: string | null;
  readonly serverAddress: string | null;
}) {
  if (automaticHostname != null) {
    return (
      <>
        <span className="min-w-0 font-mono text-sm break-all">{automaticHostname}</span>
        <CopyButton text={automaticHostname} label="Copiar" />
      </>
    );
  }
  if (serverAddress == null) {
    return <span className="text-sm">IP do servidor do projeto</span>;
  }
  return (
    <>
      <span className="font-mono text-sm">{serverAddress}</span>
      <CopyButton text={serverAddress} label="Copiar" />
    </>
  );
}
