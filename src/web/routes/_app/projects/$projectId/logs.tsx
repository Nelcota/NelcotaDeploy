import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ContainerIcon, RotateCwIcon, ScrollTextIcon } from "lucide-react";
import { useState } from "react";

import { formatDateTime, formatRelativeTime, pluralize } from "@/shared/format";
import { LogViewer } from "@/web/components/log-viewer";
import { currentContainer, TabHeader } from "@/web/components/project-header";
import { type ProjectDetails, projectQueryOptions } from "@/web/components/project-query";
import { EmptyState, ErrorState } from "@/web/components/states";
import { ContainerStateBadge } from "@/web/components/status-badge";
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
  const listedDeployments = deployments.data ?? [];
  const now = new Date();

  const header = (
    <TabHeader
      icon={ScrollTextIcon}
      title="Logs"
      description="Saída do contêiner em tempo real. Valores de secrets são ocultados."
      actions={
        currentDeploymentId == null ? null : (
          <Select value={selected} onValueChange={setChosen}>
            <SelectTrigger aria-label="Logs de qual deploy" className="w-full sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {listedDeployments.some(
                (deployment) => deployment.id === currentDeploymentId,
              ) ? null : (
                <SelectItem value={currentDeploymentId}>Deploy no ar</SelectItem>
              )}
              {listedDeployments.map((deployment) => (
                <SelectItem key={deployment.id} value={deployment.id}>
                  {deployment.id === currentDeploymentId ? "Deploy no ar" : "Deploy"}
                  <span className="font-mono">
                    {deployment.commitSha?.slice(0, SHORT_SHA_LENGTH) ?? "—"}
                  </span>
                  <span className="text-muted-foreground">
                    {formatRelativeTime(deployment.createdAt, now)}
                  </span>
                </SelectItem>
              ))}
              <SelectItem value={ALL_DEPLOYMENTS}>Todos os deploys recentes</SelectItem>
            </SelectContent>
          </Select>
        )
      }
    />
  );

  if (details == null) {
    return (
      <section aria-label="Logs de execução" className="space-y-6">
        {header}
        <Skeleton className="h-[min(70dvh,44rem)] rounded-xl" />
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
    <section aria-label="Logs de execução" className="space-y-4">
      {header}
      <ContainerStrip details={details} now={now} />
      <LogViewer
        url={url}
        heightClass="h-[min(70dvh,44rem)]"
        downloadName={`${details.project.slug}.log`}
        emptyMessage="Aguardando linhas do contêiner…"
      />
    </section>
  );
}

/** Where the live lines come from: the current container, its state and restarts. */
function ContainerStrip({
  details,
  now,
}: {
  readonly details: ProjectDetails;
  readonly now: Date;
}) {
  const container = currentContainer(details);
  if (container == null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ContainerIcon aria-hidden className="size-4 text-faint" />O worker ainda não informou o
        contêiner do deploy atual.
      </p>
    );
  }
  const restarts = container.restartCount ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-border/70">
      <ContainerStateBadge state={container.state} health={container.health} />
      <span className="flex min-w-0 items-center gap-2">
        <ContainerIcon aria-hidden className="size-4 shrink-0 text-faint" />
        <span className="truncate font-mono text-xs" title={container.image ?? undefined}>
          {container.name}
        </span>
      </span>
      {container.state === "running" && container.startedAt != null ? (
        <time
          dateTime={container.startedAt}
          title={formatDateTime(container.startedAt)}
          className="text-xs text-muted-foreground"
        >
          iniciado {formatRelativeTime(container.startedAt, now)}
        </time>
      ) : null}
      <span
        className={
          restarts > 0
            ? "flex items-center gap-1.5 text-xs text-warning"
            : "flex items-center gap-1.5 text-xs text-faint"
        }
      >
        <RotateCwIcon aria-hidden className="size-3.5" />
        {pluralize(restarts, "reinício", "reinícios")}
      </span>
    </div>
  );
}
