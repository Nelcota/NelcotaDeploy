import { Link } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";

import { useNow } from "@/web/components/clock/use-now";
import { DEPLOYMENT_STATUS_LABELS } from "@/web/components/layout/labels";
import type { ProjectDetails } from "@/web/components/projects/project-query";
import { Button } from "@/web/components/ui/button";

import { DOMAIN_SETUP_ID, type DomainItem, dnsRecordId, domainUrl } from "../domains";
import {
  DomainProgress,
  certificateFailureStartedAt,
  domainAccess,
  domainProgress,
  type useDomainUptime,
} from "../uptime";
import { useDomainsDns } from "../use-domains-dns";
import type { useProjectDomains } from "../use-project-domains";

type ApplyChanges = ReturnType<typeof useProjectDomains>["applyChanges"];
type Uptime = ReturnType<typeof useDomainUptime>;

/** The next action for reaching the application after adding its first address. */
export function DomainSetup({
  details,
  domain,
  canEdit,
  applyChanges,
  uptime,
}: {
  readonly details: ProjectDetails;
  readonly domain: DomainItem | undefined;
  readonly canEdit: boolean;
  readonly applyChanges: ApplyChanges;
  readonly uptime: Uptime;
}) {
  return (
    <section
      id={DOMAIN_SETUP_ID}
      aria-labelledby="domain-setup-title"
      tabIndex={-1}
      className="scroll-mt-4 space-y-3 rounded-xl border border-border bg-card p-4 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <h3 id="domain-setup-title" className="text-base font-semibold">
        {domain == null ? "Configure um endereço para o app" : "Acesso ao app"}
      </h3>
      {domain == null ? (
        <p className="text-sm text-muted-foreground">
          {canEdit
            ? "Salve um domínio abaixo. Em seguida, configure o DNS e acompanhe aqui quando o endereço estiver pronto para abrir."
            : "Peça a alguém com permissão para adicionar um domínio a este projeto."}
        </p>
      ) : (
        <DomainAccessStatus
          domain={domain}
          details={details}
          applyChanges={applyChanges}
          uptime={uptime}
        />
      )}
    </section>
  );
}

function DomainAccessStatus({
  domain,
  details,
  applyChanges,
  uptime,
}: {
  readonly domain: DomainItem;
  readonly details: ProjectDetails;
  readonly applyChanges: ApplyChanges;
  readonly uptime: Uptime;
}) {
  const projectId = details.project.id;
  const now = useNow();
  const checks = uptime.byHostname.get(domain.hostname);
  const access = domainAccess({
    pending: details.pendingRuntimeChanges,
    publishedAt: details.liveDeployment?.finishedAt ?? null,
    uptime: checks,
    now,
  });
  const dns = useDomainsDns(projectId, access === "checking" || access === "dns");
  const progress = domainProgress({
    access,
    dns: dns.data?.find((entry) => entry.hostname === domain.hostname),
    httpsEnabled: domain.httpsEnabled,
    uptime: checks,
    now,
  });
  const deployment = applyChanges.activeDeployment;
  const pendingMessage =
    deployment == null
      ? undefined
      : `Deploy em andamento. ${DEPLOYMENT_STATUS_LABELS[deployment.status]}. Aguarde a ativação do endereço.`;
  const refreshing = dns.isFetching || uptime.refreshing;
  return (
    <>
      <p className="font-mono text-sm break-all">{domainUrl(domain)}</p>
      <DomainProgress
        domain={domain}
        progress={progress}
        pendingMessage={pendingMessage}
        certificateSince={certificateFailureStartedAt(checks?.recent ?? [])}
        recentChecks={checks?.recent}
        deploymentId={details.liveDeployment?.id ?? null}
        projectId={projectId}
        proxyLogsAvailable={details.liveDeployment?.proxyLogsAvailable === true}
      >
        {access === "pending" ? <DomainApplyAction state={applyChanges} /> : null}
        <DnsInstructions projectId={projectId} hostname={domain.hostname} />
        {access !== "pending" && access !== "ready" && access !== "private" ? (
          <Button
            variant="outline"
            className="min-h-11"
            aria-disabled={refreshing}
            onClick={() => {
              if (refreshing === false) {
                void Promise.all([dns.refetch(), uptime.refresh()]);
              }
            }}
          >
            {refreshing ? "Consultando…" : "Atualizar status"}
          </Button>
        ) : null}
      </DomainProgress>
    </>
  );
}

function DnsInstructions({
  projectId,
  hostname,
}: {
  readonly projectId: string;
  readonly hostname: string;
}) {
  return (
    <Button variant="outline" className="min-h-11" asChild>
      <Link to="/projects/$projectId/dns" params={{ projectId }} hash={dnsRecordId(hostname)}>
        Ver registro DNS
      </Link>
    </Button>
  );
}

function DomainApplyAction({ state }: { readonly state: ApplyChanges }) {
  const deployment = state.activeDeployment;
  if (deployment != null) {
    return (
      <Button className="min-h-11" asChild>
        <Link
          to="/projects/$projectId/deployments/$deploymentId"
          params={{ projectId: state.projectId, deploymentId: deployment.id }}
        >
          Acompanhar aplicação do domínio
        </Link>
      </Button>
    );
  }

  if (state.canApply === false && state.redeploy.isPending === false) {
    return (
      <p className="self-center text-sm text-muted-foreground">
        Peça a alguém com permissão de deploy para aplicar as alterações.
      </p>
    );
  }

  return (
    <Button
      className="min-h-11"
      disabled={state.redeploy.isPending}
      onClick={() => state.redeploy.mutate()}
    >
      {state.redeploy.isPending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
      {state.redeploy.isPending ? "Aplicando…" : "Aplicar domínio"}
    </Button>
  );
}
