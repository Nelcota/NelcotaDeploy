import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";

import { useNow } from "@/web/components/clock/use-now";
import { DnsAutomation } from "@/web/components/domains/cloudflare/dns-automation";
import { List, ListRow, Tag } from "@/web/components/layout/layout";
import { ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { TabHeader } from "@/web/components/projects/project-header";
import { type ProjectDetails, projectQueryOptions } from "@/web/components/projects/project-query";
import { useCan } from "@/web/components/shell/use-permissions";
import { Button } from "@/web/components/ui/button";
import { getServerAddressFn } from "@/web/functions/servers/server-address.functions";

import { ManualDnsRecord } from "../dns-record-fields";
import {
  type DomainDns,
  certificateHistoryId,
  dnsConfigurationId,
  dnsRecordId,
  dnsTag,
  needsDnsHelp,
} from "../domains";
import {
  DomainProgress,
  certificateFailureStartedAt,
  domainAccess,
  domainProgress,
  useDomainUptime,
} from "../uptime";
import { useDomainsDns } from "../use-domains-dns";

const SERVER_ADDRESS_STALE_IN_MS = 600_000;

/** Diagnoses DNS and reviews provider changes without adding or removing project domains. */
export function ProjectDnsPage({ projectId }: { readonly projectId: string }) {
  const project = useQuery(projectQueryOptions(projectId));
  const query = useDomainsDns(projectId);
  const can = useCan();
  const hash = useLocation({ select: (location) => location.hash });
  const details = project.data;
  const uptime = useDomainUptime(projectId, {
    enabled: details?.liveDeployment != null && details.domains.length > 0,
    releaseId: details?.liveDeployment?.id ?? null,
    trackProgress: true,
  });
  const targetId =
    details?.domains.some(
      (domain) =>
        dnsRecordId(domain.hostname) === hash ||
        dnsConfigurationId(domain.hostname) === hash ||
        certificateHistoryId(domain.hostname) === hash,
    ) === true
      ? hash
      : null;
  if (project.isError) {
    return <ErrorState error={project.error} onRetry={() => void project.refetch()} />;
  }

  if (details == null) {
    return <ListSkeleton rows={2} />;
  }

  const { domains } = details;
  const dns = new Map((query.data ?? []).map((entry) => [entry.hostname, entry]));
  return (
    <>
      <TabHeader
        title="Registros DNS dos domínios"
        description={
          needsDnsHelp(domains, dns)
            ? "Confira os campos do registro e faça a correção no provedor do domínio."
            : undefined
        }
        actions={
          <div className="grid w-full gap-2 sm:flex">
            <Button variant="outline" className="min-h-11" asChild>
              <Link to="/projects/$projectId/domains" params={{ projectId }}>
                Ver domínios
              </Link>
            </Button>
            {domains.length === 0 ? null : (
              <Button
                variant="outline"
                className="min-h-11"
                aria-disabled={query.isFetching || uptime.refreshing}
                onClick={() => {
                  if (query.isFetching === false && uptime.refreshing === false) {
                    void query.refetch();
                    if (details.liveDeployment != null) {
                      void uptime.refresh();
                    }
                  }
                }}
              >
                {query.isFetching ? "Consultando DNS…" : "Verificar DNS novamente"}
              </Button>
            )}
          </div>
        }
      />
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : null}
      <DnsRecords
        details={details}
        dns={dns}
        uptime={uptime.byHostname}
        targetId={targetId}
        loading={query.isLoading || uptime.loading}
      />
      <DnsAutomation projectId={projectId} canEdit={can("domain:write")} domains={domains} />
    </>
  );
}

function DnsRecords({
  details,
  dns,
  uptime,
  targetId,
  loading,
}: {
  readonly details: ProjectDetails;
  readonly dns: ReadonlyMap<string, DomainDns>;
  readonly uptime: ReturnType<typeof useDomainUptime>["byHostname"];
  readonly targetId: string | null;
  readonly loading: boolean;
}) {
  const { domains, project, liveDeployment } = details;
  const projectId = project.id;
  const now = useNow();
  const server = useQuery({
    queryKey: ["server-address", projectId],
    queryFn: () => getServerAddressFn({ data: { projectId } }),
    enabled: domains.length > 0,
    staleTime: SERVER_ADDRESS_STALE_IN_MS,
  });
  const automaticHostname = domains.find((domain) => domain.automatic)?.hostname ?? null;
  const historyTarget = domains.some(
    (domain) => certificateHistoryId(domain.hostname) === targetId,
  );
  const focusId = historyTarget && (loading || server.isLoading) ? null : targetId;
  useEffect(() => {
    if (focusId == null) {
      return;
    }

    const target = document.getElementById(focusId);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "start" });
  }, [focusId]);

  if (domains.length === 0) {
    return (
      <List>
        <ListRow>Adicione um domínio ao projeto para consultar o registro.</ListRow>
      </List>
    );
  }

  return (
    <>
      {server.isError ? (
        <ErrorState error={server.error} onRetry={() => void server.refetch()} />
      ) : null}
      <List>
        {domains.map((domain) => {
          const record = dns.get(domain.hostname);
          const checks = uptime.get(domain.hostname);
          const access = domainAccess({
            pending: details.pendingRuntimeChanges,
            publishedAt: liveDeployment?.finishedAt ?? null,
            uptime: checks,
            now,
          });
          const progress = domainProgress({
            access,
            dns: record,
            httpsEnabled: domain.httpsEnabled,
            uptime: checks,
            now,
          });
          return (
            <ListRow key={domain.hostname} className="flex-col items-stretch gap-3">
              <DnsRecordStatus hostname={domain.hostname} state={dnsTag(record)} />
              {liveDeployment == null ? null : (
                <DomainProgress
                  domain={domain}
                  progress={progress}
                  certificateSince={certificateFailureStartedAt(checks?.recent ?? [])}
                  recentChecks={checks?.recent}
                  deploymentId={liveDeployment.id}
                  projectId={projectId}
                  proxyLogsAvailable={liveDeployment.proxyLogsAvailable}
                  openHistory={targetId === certificateHistoryId(domain.hostname)}
                />
              )}
              <div
                id={dnsConfigurationId(domain.hostname)}
                tabIndex={-1}
                className="scroll-mt-4 rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={`Configuração DNS de ${domain.hostname}`}
              >
                <ManualDnsRecord
                  hostname={domain.hostname}
                  alias={domain.automatic ? null : automaticHostname}
                  serverAddress={server.data ?? null}
                  loading={server.isPending}
                />
              </div>
            </ListRow>
          );
        })}
      </List>
    </>
  );
}

function DnsRecordStatus({
  hostname,
  state,
}: {
  readonly hostname: string;
  readonly state: ReturnType<typeof dnsTag>;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3
          id={dnsRecordId(hostname)}
          tabIndex={-1}
          className="scroll-mt-4 rounded-sm font-mono text-sm font-medium wrap-anywhere focus-visible:outline-2 focus-visible:outline-ring"
        >
          {hostname}
        </h3>
        <Tag tone={state?.tone ?? "neutral"}>{state?.label ?? "DNS ainda não confirmado"}</Tag>
      </div>
      {state == null ? null : (
        <p className="text-sm text-muted-foreground wrap-anywhere">{state.detail}</p>
      )}
    </>
  );
}
