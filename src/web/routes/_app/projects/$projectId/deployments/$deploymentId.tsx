import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  CalendarCheckIcon,
  CalendarClockIcon,
  ChevronLeftIcon,
  ContainerIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  InfoIcon,
  LoaderCircleIcon,
  ListChecksIcon,
  type LucideIcon,
  OctagonXIcon,
  PackageIcon,
  RotateCwIcon,
  ScrollTextIcon,
  TimerIcon,
  Undo2Icon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { durationBetween, formatDateTime, formatDuration } from "@/shared/format";
import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { DeploymentStages } from "@/web/components/deployment-stages";
import {
  ACTIVE_DEPLOYMENT_STATUSES,
  DEPLOYMENT_TRIGGER_ICONS,
  DEPLOYMENT_TRIGGER_LABELS,
} from "@/web/components/labels";
import { CardTitleRow } from "@/web/components/layout";
import { LogViewer } from "@/web/components/log-viewer";
import { TabHeader } from "@/web/components/project-header";
import { projectQueryOptions } from "@/web/components/project-query";
import { RollbackButton } from "@/web/components/rollback-button";
import { ErrorState } from "@/web/components/states";
import { DeploymentStatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { Card } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";
import { useAction } from "@/web/components/use-action";
import { useCan } from "@/web/components/use-permissions";
import {
  cancelDeploymentFn,
  getDeploymentFn,
  retryDeploymentFn,
} from "@/web/functions/deployments.functions";

const ACTIVE_REFRESH_INTERVAL_IN_MS = 2000;
const CLOCK_TICK_IN_MS = 1000;
const SHORT_SHA_LENGTH = 7;
const SHORT_ID_LENGTH = 8;

export const Route = createFileRoute("/_app/projects/$projectId/deployments/$deploymentId")({
  head: () => ({ meta: [{ title: "Deploy · Nelcota Deploy" }] }),
  component: DeploymentDetailPage,
});

/** Current time that updates every second while enabled, for live durations. */
function useNow(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (enabled === false) {
      return undefined;
    }
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_IN_MS);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

function Detail({
  icon: Icon,
  label,
  children,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground sm:w-32">
        <Icon aria-hidden className="size-4 shrink-0" />
        {label}
      </dt>
      <dd className="min-w-0 text-sm break-all sm:truncate">{children}</dd>
    </div>
  );
}

function DeploymentDetailPage() {
  const { projectId, deploymentId } = Route.useParams();
  const can = useCan();
  const queryClient = useQueryClient();
  const project = useQuery(projectQueryOptions(projectId));
  const deployment = useQuery({
    queryKey: ["deployment", deploymentId],
    queryFn: () => getDeploymentFn({ data: { deploymentId } }),
    refetchInterval: (query) =>
      query.state.data != null && ACTIVE_DEPLOYMENT_STATUSES.has(query.state.data.status)
        ? ACTIVE_REFRESH_INTERVAL_IN_MS
        : false,
  });
  const active = deployment.data != null && ACTIVE_DEPLOYMENT_STATUSES.has(deployment.data.status);
  const now = useNow(active);
  // Only announce results the user watched happen, not finished deploys opened later.
  const watchedLive = useRef(false);
  if (active) {
    watchedLive.current = true;
  }
  const navigate = useNavigate();
  const retry = useAction({
    action: () => retryDeploymentFn({ data: { deploymentId } }),
    successMessage: "Novo deploy colocado na fila",
    invalidate: [
      ["deployments", projectId],
      ["project", projectId],
    ],
    onSuccess: async (result) => {
      await navigate({
        to: "/projects/$projectId/deployments/$deploymentId",
        params: { projectId, deploymentId: result.deploymentId },
      });
    },
  });
  const cancel = useAction({
    action: () => cancelDeploymentFn({ data: { deploymentId } }),
    successMessage: (result) =>
      result === "cancelling"
        ? "Cancelamento solicitado; o worker vai parar no próximo passo"
        : "Deploy cancelado",
    invalidate: [
      ["deployment", deploymentId],
      ["deployments", projectId],
    ],
  });

  const handleEnd = (summary: unknown) => {
    const status =
      typeof summary === "object" && summary != null && "status" in summary ? summary.status : null;
    const announce = watchedLive.current;
    if (announce && status === "succeeded") {
      toast.success("Deploy concluído");
    } else if (announce && status === "failed") {
      toast.error("O deploy falhou. Veja os logs para o motivo.");
    }
    void queryClient.invalidateQueries({ queryKey: ["deployment", deploymentId] });
    void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["deployments", projectId] });
  };

  const backLink = (
    <Link
      to="/projects/$projectId/deployments"
      params={{ projectId }}
      className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <ChevronLeftIcon aria-hidden className="size-4" />
      Deploys
    </Link>
  );
  if (deployment.isError) {
    return (
      <section aria-label="Detalhes do deploy" className="space-y-6">
        {backLink}
        <ErrorState error={deployment.error} onRetry={() => void deployment.refetch()} />
      </section>
    );
  }
  if (deployment.data == null) {
    return (
      <section aria-label="Carregando deploy" aria-busy="true" className="space-y-6">
        {backLink}
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-[28rem] rounded-xl" />
      </section>
    );
  }
  const data = deployment.data;
  const sha = data.commitSha ?? data.requestedCommitSha;
  const finishedAt =
    data.finishedAt ?? (active && data.startedAt != null ? now.toISOString() : null);

  const repositoryFullName = project.data?.project.repositoryFullName ?? null;
  const TriggerIcon = DEPLOYMENT_TRIGGER_ICONS[data.trigger];
  const canRollback =
    data.status === "succeeded" &&
    data.imageTag != null &&
    data.isLive === false &&
    can("deployment:create");

  const canRetry =
    (data.status === "failed" || data.status === "cancelled") && can("deployment:create");
  const retryButton = canRetry ? (
    <Button size="sm" disabled={retry.isPending} onClick={() => retry.mutate()}>
      {retry.isPending ? (
        <LoaderCircleIcon aria-hidden className="animate-spin" />
      ) : (
        <RotateCwIcon aria-hidden />
      )}
      Tentar de novo
    </Button>
  ) : null;

  const cancelButton =
    active && can("deployment:create") ? (
      <ConfirmDialog
        trigger={
          <Button
            variant="destructive"
            size="sm"
            disabled={cancel.isPending || data.cancelRequestedAt != null}
          >
            <OctagonXIcon aria-hidden />
            {data.cancelRequestedAt == null ? "Cancelar deploy" : "Cancelando…"}
          </Button>
        }
        title="Cancelar este deploy?"
        description="A versão atual continua no ar. Se o deploy já estiver em andamento, ele para no próximo passo e o contêiner novo é removido."
        confirmLabel="Cancelar deploy"
        cancelLabel="Continuar deploy"
        destructive
        onConfirm={() => cancel.mutate()}
      />
    ) : null;

  const rollbackButton = canRollback ? <RollbackButton deployment={data} /> : null;
  const headerAction = cancelButton ?? retryButton ?? rollbackButton;

  return (
    <section aria-label="Detalhes do deploy" className="space-y-6">
      <div className="space-y-3">
        {backLink}
        <TabHeader
          title={
            <>
              <span>
                Deploy{" "}
                <span className="font-mono">
                  {sha == null ? data.id.slice(-SHORT_ID_LENGTH) : sha.slice(0, SHORT_SHA_LENGTH)}
                </span>
              </span>
              <DeploymentStatusBadge status={data.status} />
            </>
          }
          description={data.commitMessage ?? "sem mensagem de commit"}
          actions={headerAction}
        />
      </div>

      <Card className="gap-5 p-5">
        <CardTitleRow icon={ListChecksIcon} title="Etapas" />
        <DeploymentStages deployment={data} />
      </Card>

      {data.status === "failed" && data.errorMessage != null ? (
        <div className="space-y-1.5 rounded-xl bg-destructive/8 px-5 py-4 ring-1 ring-destructive/25">
          <p className="text-sm font-medium text-destructive">
            {project.data?.project.currentDeploymentId == null
              ? "O deploy falhou e a aplicação ainda não está no ar."
              : "O deploy falhou. A versão anterior continua no ar."}
          </p>
          <pre className="font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">
            {data.errorMessage}
          </pre>
        </div>
      ) : null}

      <Card className="gap-4 p-5">
        <CardTitleRow icon={InfoIcon} title="Detalhes" />
        <dl className="grid gap-x-10 gap-y-2.5 md:grid-cols-2">
          <Detail icon={GitCommitHorizontalIcon} label="Commit">
            {sha == null || repositoryFullName == null ? (
              <span className="font-mono">{sha?.slice(0, SHORT_SHA_LENGTH) ?? "—"}</span>
            ) : (
              <a
                href={`https://github.com/${repositoryFullName}/commit/${sha}`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 rounded-sm font-mono underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {sha.slice(0, SHORT_SHA_LENGTH)}
                <ExternalLinkIcon aria-hidden className="size-3.5" />
                <span className="sr-only">(abre no GitHub)</span>
              </a>
            )}
          </Detail>
          <Detail icon={GitBranchIcon} label="Branch">
            <span className="font-mono">{data.branch}</span>
          </Detail>
          <Detail icon={TriggerIcon} label="Origem">
            {DEPLOYMENT_TRIGGER_LABELS[data.trigger]} · {data.triggeredByLabel}
          </Detail>
          <Detail icon={CalendarClockIcon} label="Início">
            {formatDateTime(data.startedAt ?? data.createdAt)}
          </Detail>
          <Detail icon={CalendarCheckIcon} label="Fim">
            {data.finishedAt == null ? "—" : formatDateTime(data.finishedAt)}
          </Detail>
          <Detail icon={TimerIcon} label="Duração">
            <span className="tabular-nums">
              {formatDuration(durationBetween(data.startedAt, finishedAt))}
            </span>
          </Detail>
          <Detail icon={PackageIcon} label="Imagem">
            <span className="font-mono" title={data.imageTag ?? undefined}>
              {data.imageTag ?? "—"}
            </span>
          </Detail>
          <Detail icon={ContainerIcon} label="Contêiner">
            <span className="font-mono" title={data.containerName ?? undefined}>
              {data.containerName ?? "—"}
            </span>
          </Detail>
          {data.sourceDeploymentId == null ? null : (
            <Detail icon={Undo2Icon} label="Imagem de">
              <Link
                to="/projects/$projectId/deployments/$deploymentId"
                params={{ projectId, deploymentId: data.sourceDeploymentId }}
                className="underline underline-offset-4"
              >
                deploy anterior
              </Link>
            </Detail>
          )}
        </dl>
      </Card>

      <h2 className="flex items-center gap-3 text-base font-semibold">
        <ScrollTextIcon aria-hidden className="size-[1.15rem] text-muted-foreground" />
        Logs do deploy
      </h2>
      <LogViewer
        url={`/api/deployments/${deploymentId}/logs`}
        heightClass={active ? "h-[28rem]" : "max-h-[28rem] min-h-24"}
        downloadName={`deploy-${deploymentId}.log`}
        emptyMessage={
          data.status === "queued"
            ? "Aguardando o worker iniciar o deploy…"
            : "Nenhuma linha registrada."
        }
        onEnd={handleEnd}
      />
    </section>
  );
}
