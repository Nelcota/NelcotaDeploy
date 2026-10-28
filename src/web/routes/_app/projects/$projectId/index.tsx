import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ExternalLinkIcon,
  GlobeIcon,
  LockIcon,
  RocketIcon,
  ServerIcon,
  UnlockIcon,
} from "lucide-react";

import {
  durationBetween,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
} from "@/shared/format";
import { DEPLOYMENT_TRIGGER_LABELS } from "@/web/components/labels";
import { ProjectHeader } from "@/web/components/project-header";
import { projectQueryOptions } from "@/web/components/project-query";
import { EmptyState, ListSkeleton } from "@/web/components/states";
import {
  ContainerStateBadge,
  DeploymentStatusBadge,
  StatusPill,
} from "@/web/components/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import { getDeploymentFn } from "@/web/functions/deployments.functions";

const SHORT_SHA_LENGTH = 12;

export const Route = createFileRoute("/_app/projects/$projectId/")({
  component: ProjectOverviewPage,
});

function DetailRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm break-all sm:text-right">{children}</dd>
    </div>
  );
}

function ProjectOverviewPage() {
  const { projectId } = Route.useParams();
  const details = useQuery(projectQueryOptions(projectId));
  const currentDeploymentId = details.data?.project.currentDeploymentId ?? null;
  const currentDeployment = useQuery({
    queryKey: ["deployment", currentDeploymentId],
    queryFn: () => getDeploymentFn({ data: { deploymentId: currentDeploymentId ?? "" } }),
    enabled: currentDeploymentId != null,
  });

  if (details.data == null) {
    return <ListSkeleton rows={4} />;
  }
  const { project, domains, containers } = details.data;
  const now = new Date();

  return (
    <>
      <ProjectHeader details={details.data} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configuração</CardTitle>
            <CardDescription>Alterações valem a partir do próximo deploy.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <DetailRow label="Repositório">{project.repositoryFullName}</DetailRow>
              <DetailRow label="Branch">
                <span className="font-mono">{project.branch}</span>
              </DetailRow>
              <DetailRow label="Dockerfile">
                <span className="font-mono">{project.dockerfilePath}</span>
              </DetailRow>
              <DetailRow label="Diretório de build">
                <span className="font-mono">{project.buildContext}</span>
              </DetailRow>
              <DetailRow label="Porta interna">{project.internalPort}</DetailRow>
              <DetailRow label="Health check">
                {project.healthCheckPath == null ? (
                  "Conexão TCP na porta"
                ) : (
                  <span className="font-mono">{project.healthCheckPath}</span>
                )}
              </DetailRow>
              <DetailRow label="Deploy automático">
                {project.autoDeploy ? "Ativado" : "Desativado"}
              </DetailRow>
            </dl>
            {project.autoDeploy ? (
              <p className="mt-3 rounded-md bg-muted p-3 text-xs text-muted-foreground">
                Para o deploy automático funcionar, configure o webhook do GitHub apontando para a
                URL exibida em Administração › Servidor, com o evento “push”.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RocketIcon aria-hidden className="size-4" />
              Deploy atual
            </CardTitle>
          </CardHeader>
          <CardContent>
            {currentDeploymentId == null ? (
              <EmptyState
                icon={RocketIcon}
                title="Nenhum deploy concluído"
                description="Clique em Deploy para publicar a aplicação."
              />
            ) : null}
            {currentDeploymentId != null && currentDeployment.data == null ? (
              <ListSkeleton rows={2} />
            ) : null}
            {currentDeployment.data == null || currentDeploymentId == null ? null : (
              <dl className="divide-y">
                <DetailRow label="Situação">
                  <DeploymentStatusBadge status={currentDeployment.data.status} />
                </DetailRow>
                <DetailRow label="Commit">
                  <span className="font-mono">
                    {currentDeployment.data.commitSha?.slice(0, SHORT_SHA_LENGTH) ?? "—"}
                  </span>
                  {currentDeployment.data.commitMessage == null
                    ? null
                    : ` · ${currentDeployment.data.commitMessage}`}
                </DetailRow>
                <DetailRow label="Origem">
                  {DEPLOYMENT_TRIGGER_LABELS[currentDeployment.data.trigger]} ·{" "}
                  {currentDeployment.data.triggeredByLabel}
                </DetailRow>
                <DetailRow label="Concluído em">
                  {formatDateTime(currentDeployment.data.finishedAt)}
                </DetailRow>
                <DetailRow label="Duração">
                  {formatDuration(
                    durationBetween(
                      currentDeployment.data.startedAt,
                      currentDeployment.data.finishedAt,
                    ),
                  )}
                </DetailRow>
                <div className="pt-3">
                  <Link
                    to="/projects/$projectId/deployments/$deploymentId"
                    params={{ projectId, deploymentId: currentDeploymentId }}
                    className="text-sm font-medium underline-offset-4 hover:underline"
                  >
                    Ver detalhes e logs do deploy
                  </Link>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GlobeIcon aria-hidden className="size-4" />
              Domínios
            </CardTitle>
          </CardHeader>
          <CardContent>
            {domains.length === 0 ? (
              <EmptyState
                icon={GlobeIcon}
                title="Nenhum domínio"
                description="Adicione domínios na aba Domínios."
              />
            ) : (
              <ul className="divide-y">
                {domains.map((domain) => (
                  <li
                    key={domain.hostname}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <a
                      href={`${domain.httpsEnabled ? "https" : "http"}://${domain.hostname}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 text-sm hover:underline"
                    >
                      {domain.httpsEnabled ? (
                        <LockIcon aria-hidden className="size-3.5" />
                      ) : (
                        <UnlockIcon aria-hidden className="size-3.5" />
                      )}
                      {domain.hostname}
                      <ExternalLinkIcon aria-hidden className="size-3.5" />
                      <span className="sr-only">
                        {domain.httpsEnabled
                          ? "(HTTPS, abre em nova aba)"
                          : "(HTTP, abre em nova aba)"}
                      </span>
                    </a>
                    {domain.automatic ? <StatusPill tone="neutral" label="Automático" /> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ServerIcon aria-hidden className="size-4" />
              Contêineres
            </CardTitle>
            <CardDescription>Estado observado pelo worker a cada poucos segundos.</CardDescription>
          </CardHeader>
          <CardContent>
            {containers.length === 0 ? (
              <EmptyState icon={ServerIcon} title="Nenhum contêiner" />
            ) : (
              <ul className="divide-y">
                {containers.map((container) => (
                  <li key={container.containerId} className="space-y-1 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-sm break-all">{container.name}</span>
                      <ContainerStateBadge state={container.state} health={container.health} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {container.state === "running"
                        ? `Em execução desde ${formatRelativeTime(container.startedAt, now)}`
                        : "Parado"}
                      {" · "}
                      {container.restartCount} reinicializações
                      {container.health == null ? "" : ` · saúde: ${container.health}`}
                      {container.deploymentId === project.currentDeploymentId ? " · atual" : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
