import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { DnsAutomation } from "@/web/components/domains/cloudflare/dns-automation";
import { List, ListRow, Tag } from "@/web/components/layout/layout";
import { ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { TabHeader } from "@/web/components/projects/project-header";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { useCan } from "@/web/components/shell/use-permissions";
import { Button } from "@/web/components/ui/button";

import { dnsTag } from "../domains";
import { useDomainsDns } from "../use-domains-dns";

/** Diagnoses DNS and reviews provider changes without adding or removing project domains. */
export function ProjectDnsPage({ projectId }: { readonly projectId: string }) {
  const project = useQuery(projectQueryOptions(projectId));
  const query = useDomainsDns(projectId);
  const can = useCan();
  if (project.isError) {
    return <ErrorState error={project.error} onRetry={() => void project.refetch()} />;
  }
  if (project.data == null) {
    return <ListSkeleton rows={2} />;
  }
  const dns = new Map((query.data ?? []).map((entry) => [entry.hostname, entry]));
  return (
    <>
      <TabHeader
        title="Registros DNS dos domínios"
        description="Confira para onde cada domínio aponta e configure os registros necessários."
        actions={
          <Button variant="outline" asChild>
            <Link to="/projects/$projectId/domains" params={{ projectId }}>
              Ver domínios
            </Link>
          </Button>
        }
      />
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : null}
      <List>
        {project.data.domains.length === 0 ? (
          <ListRow>Nenhum domínio associado ao projeto.</ListRow>
        ) : (
          project.data.domains.map((domain) => {
            const state = dnsTag(dns.get(domain.hostname));
            return (
              <ListRow key={domain.hostname} className="flex-wrap">
                <span className="min-w-0 font-mono text-sm break-all">{domain.hostname}</span>
                <Tag tone={state?.tone ?? "neutral"}>
                  {state?.label ?? "DNS ainda não confirmado"}
                </Tag>
                {state == null ? null : (
                  <p className="w-full text-xs text-muted-foreground">{state.detail}</p>
                )}
              </ListRow>
            );
          })
        )}
      </List>
      <DnsAutomation
        projectId={projectId}
        canEdit={can("domain:write")}
        domains={project.data.domains}
        dns={dns}
      />
    </>
  );
}
