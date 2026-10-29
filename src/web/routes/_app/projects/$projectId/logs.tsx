import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ClockIcon, ContainerIcon, RotateCwIcon } from "lucide-react";
import { useState } from "react";

import { formatDateTime, formatRelativeTime, pluralize } from "@/shared/format";
import { LogViewer } from "@/web/components/log-viewer";
import { currentContainer, TabHeader } from "@/web/components/project-header";
import { type ProjectDetails, projectQueryOptions } from "@/web/components/project-query";
import { EmptyState, ErrorState } from "@/web/components/states";
import { Button } from "@/web/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Skeleton } from "@/web/components/ui/skeleton";
import { listDeploymentsFn } from "@/web/functions/deployments.functions";

const RECENT_DEPLOYMENTS = 10;
const ALL_DEPLOYMENTS = "all";
const SHORT_SHA_LENGTH = 7;

type DeploymentItem = Awaited<ReturnType<typeof listDeploymentsFn>>[number];

export const Route = createFileRoute("/_app/projects/$projectId/logs")({
  head: () => ({ meta: [{ title: "Logs · Nelcota Deploy" }] }),
  component: RuntimeLogsPage,
});

function RuntimeLogsPage() {
  const { projectId } = Route.useParams();
  const project = useQuery(projectQueryOptions(projectId));
  const deployments = useQuery({
    queryKey: ["deployments", projectId, "succeeded"],
    queryFn: () =>
      listDeploymentsFn({ data: { projectId, status: "succeeded", limit: RECENT_DEPLOYMENTS } }),
  });
  // Null follows the deploy that is live, so a new deploy switches the view by itself.
  const [chosen, setChosen] = useState<string | null>(null);

  if (project.isError) {
    return <ErrorState error={project.error} onRetry={() => void project.refetch()} />;
  }
  const details = project.data;
  const currentDeploymentId = details?.project.currentDeploymentId ?? null;
  const selected = chosen ?? currentDeploymentId ?? ALL_DEPLOYMENTS;
  const now = new Date();

  const header = (
    <TabHeader
      title="Logs"
      description={
        details == null || currentDeploymentId == null ? (
          "Saída do contêiner em tempo real. Valores de secrets são ocultados."
        ) : (
          <SourceDescription details={details} selected={selected} now={now} />
        )
      }
    />
  );

  if (details == null) {
    return (
      <section aria-label="Logs de execução" className="space-y-6">
        {header}
        <Skeleton className="h-[min(72dvh,46rem)] rounded-xl" />
      </section>
    );
  }
  if (currentDeploymentId == null) {
    return (
      <section aria-label="Logs de execução" className="space-y-6">
        {header}
        <EmptyState
          icon={ContainerIcon}
          title="Nenhum contêiner implantado"
          description="Os logs aparecem aqui assim que o primeiro deploy colocar a aplicação no ar."
          action={
            <Button variant="outline" asChild>
              <Link to="/projects/$projectId/deployments" params={{ projectId }}>
                Ver deploys
              </Link>
            </Button>
          }
        />
      </section>
    );
  }

  const url =
    selected === ALL_DEPLOYMENTS
      ? `/api/projects/${projectId}/runtime-logs`
      : `/api/projects/${projectId}/runtime-logs?deploymentId=${encodeURIComponent(selected)}`;
  return (
    <section aria-label="Logs de execução" className="space-y-6">
      {header}
      <LogViewer
        url={url}
        heightClass="h-[min(72dvh,46rem)]"
        downloadName={`${details.project.slug}.log`}
        emptyMessage="Aguardando linhas do contêiner…"
        toolbarStart={
          <DeploymentPicker
            deployments={deployments.data ?? []}
            currentDeploymentId={currentDeploymentId}
            selected={selected}
            now={now}
            onChange={setChosen}
          />
        }
      />
    </section>
  );
}

function shortShaOf(deployment: DeploymentItem): string {
  const sha = deployment.commitSha ?? deployment.requestedCommitSha;
  return sha == null ? deployment.id.slice(-SHORT_SHA_LENGTH) : sha.slice(0, SHORT_SHA_LENGTH);
}

/** Which deploy the console streams: the live one by default, an older one, or all of them. */
function DeploymentPicker({
  deployments,
  currentDeploymentId,
  selected,
  now,
  onChange,
}: {
  readonly deployments: readonly DeploymentItem[];
  readonly currentDeploymentId: string;
  readonly selected: string;
  readonly now: Date;
  readonly onChange: (deploymentId: string) => void;
}) {
  const liveListed = deployments.some((deployment) => deployment.id === currentDeploymentId);
  return (
    <Select value={selected} onValueChange={onChange}>
      <SelectTrigger
        aria-label="Deploy exibido"
        className="h-9 w-full border-0 bg-white/5 text-sm text-console-foreground ring-0"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {liveListed ? null : <SelectItem value={currentDeploymentId}>Deploy no ar</SelectItem>}
        {deployments.map((deployment) => (
          <SelectItem key={deployment.id} value={deployment.id}>
            <span className="font-mono">{shortShaOf(deployment)}</span>
            <span className="text-muted-foreground">
              {deployment.id === currentDeploymentId
                ? "no ar"
                : formatRelativeTime(deployment.createdAt, now)}
            </span>
          </SelectItem>
        ))}
        <SelectItem value={ALL_DEPLOYMENTS}>Todos os deploys recentes</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** One line under the title saying where the lines come from. */
function SourceDescription({
  details,
  selected,
  now,
}: {
  readonly details: ProjectDetails;
  readonly selected: string;
  readonly now: Date;
}) {
  if (selected === ALL_DEPLOYMENTS) {
    return "Linhas de todos os deploys recentes, do mais antigo ao mais novo.";
  }
  if (selected !== details.project.currentDeploymentId) {
    return "Logs de um deploy anterior; o contêiner dele pode já ter sido removido.";
  }
  const container = currentContainer(details);
  if (container == null) {
    return "Saída do contêiner em tempo real. O worker ainda não informou o contêiner do deploy.";
  }
  const restarts = container.restartCount ?? 0;
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <ContainerIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate font-mono text-xs" title={container.image ?? undefined}>
          {container.name}
        </span>
      </span>
      {container.state === "running" && container.startedAt != null ? (
        <span className="inline-flex items-center gap-1.5">
          <ClockIcon aria-hidden className="size-3.5 shrink-0" />
          <time dateTime={container.startedAt} title={formatDateTime(container.startedAt)}>
            iniciado {formatRelativeTime(container.startedAt, now)}
          </time>
        </span>
      ) : null}
      <span
        className={
          restarts > 0
            ? "inline-flex items-center gap-1.5 text-warning"
            : "inline-flex items-center gap-1.5"
        }
      >
        <RotateCwIcon aria-hidden className="size-3.5 shrink-0" />
        {pluralize(restarts, "reinício", "reinícios")}
      </span>
    </span>
  );
}
