import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { toUserMessage } from "@/web/components/layout/error-message";
import { Button } from "@/web/components/ui/button";
import { getCloudflareConnectionFn } from "@/web/functions/domains/cloudflare.functions";

import { DnsCard } from "../dns-card";
import type { DomainDns, DomainItem } from "../domains";
import { CloudflareDnsCard } from "./cloudflare-dns-card";

export function DnsAutomation({
  projectId,
  domains,
  dns,
  canEdit,
}: {
  readonly projectId: string;
  readonly domains: readonly DomainItem[];
  readonly dns: ReadonlyMap<string, DomainDns>;
  readonly canEdit: boolean;
}) {
  const connection = useQuery({
    queryKey: ["cloudflare-connection"],
    queryFn: () => getCloudflareConnectionFn(),
  });
  if (connection.data?.configured === true && canEdit) {
    return (
      <CloudflareDnsCard
        projectId={projectId}
        domains={domains}
        revision={connection.data.connectedAt}
      />
    );
  }
  const automaticHostname = domains.find((domain) => domain.automatic)?.hostname ?? null;
  return (
    <div className="space-y-4">
      {connection.isError ? (
        <div role="status" className="space-y-2">
          <p className="text-sm text-warning">
            {toUserMessage(
              connection.error,
              "Não foi possível verificar a conexão com a Cloudflare.",
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void connection.refetch()}
          >
            Consultar conexão com a Cloudflare
          </Button>
        </div>
      ) : null}
      {canEdit && connection.data?.configured === false ? (
        <p className="text-sm text-muted-foreground">
          Para configurar os registros automaticamente,{" "}
          <Link to="/settings/integrations/cloudflare" className="underline">
            conecte a Cloudflare
          </Link>
          .
        </p>
      ) : null}
      <DnsCard
        projectId={projectId}
        automaticHostname={automaticHostname}
        domains={domains}
        dns={dns}
      />
    </div>
  );
}
