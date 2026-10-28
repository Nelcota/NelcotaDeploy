import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { InfoIcon, ListChecksIcon, OctagonXIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { durationBetween, formatDateTime, formatDuration } from "@/shared/format";
import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { DeploymentStages } from "@/web/components/deployment-stages";
import { ACTIVE_DEPLOYMENT_STATUSES, DEPLOYMENT_TRIGGER_LABELS } from "@/web/components/labels";
import { CardTitleRow } from "@/web/components/layout";
import { LogViewer } from "@/web/components/log-viewer";
import { ErrorState, ListSkeleton } from "@/web/components/states";
import { DeploymentStatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { Card } from "@/web/components/ui/card";
import { useAction } from "@/web/components/use-action";
import { useCan } from "@/web/components/use-permissions";
import { cancelDeploymentFn, getDeploymentFn } from "@/web/functions/deployments.functions";

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

function Detail({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="shrink-0 text-sm text-muted-foreground sm:w-28">{label}</dt>
      <dd className="min-w-0 text-sm break-all sm:truncate">{children}</dd>
    </div>
  );
}

function DeploymentDetailPage() {
  const { projectId, deploymentId } = Route.useParams();
  const can = useCan();
  const queryClient = useQueryClient();
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

  if (deployment.isError) {
    return <ErrorState error={deployment.error} onRetry={() => void deployment.refetch()} />;
  }
  if (deployment.data == null) {
    return <ListSkeleton rows={4} />;
  }
  const data = deployment.data;
  const sha = data.commitSha ?? data.requestedCommitSha;
  const finishedAt =
    data.finishedAt ?? (active && data.startedAt != null ? now.toISOString() : null);

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
        destructive
        onConfirm={() => cancel.mutate()}
      />
    ) : null;

  return (
    <section aria-label="Detalhes do deploy" className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <Link
            to="/projects/$projectId/deployments"
            params={{ projectId }}
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:underline focus-visible:outline-none"
          >
            Deploys
          </Link>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <h2 className="text-xl font-semibold tracking-tight">
              Deploy{" "}
              <span className="font-mono">
                {sha == null ? data.id.slice(-SHORT_ID_LENGTH) : sha.slice(0, SHORT_SHA_LENGTH)}
              </span>
            </h2>
            <DeploymentStatusBadge status={data.status} />
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {data.commitMessage ?? "sem mensagem de commit"}
          </p>
        </div>
        {cancelButton}
      </div>

      <Card className="gap-5 p-5">
        <CardTitleRow icon={ListChecksIcon} title="Etapas" />
        <DeploymentStages deployment={data} />
      </Card>

      {data.status === "failed" && data.errorMessage != null ? (
        <div
          role="alert"
          className="space-y-1.5 rounded-xl bg-destructive/8 px-5 py-4 ring-1 ring-destructive/25"
        >
          <p className="text-sm font-medium text-destructive">
            O deploy falhou. A versão anterior continua no ar.
          </p>
          <pre className="font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">
            {data.errorMessage}
          </pre>
        </div>
      ) : null}

      <Card className="gap-4 p-5">
        <CardTitleRow icon={InfoIcon} title="Detalhes" />
        <dl className="grid gap-x-10 gap-y-2.5 md:grid-cols-2">
          <Detail label="Branch">
            <span className="font-mono">{data.branch}</span>
          </Detail>
          <Detail label="Origem">
            {DEPLOYMENT_TRIGGER_LABELS[data.trigger]} · {data.triggeredByLabel}
          </Detail>
          <Detail label="Início">{formatDateTime(data.startedAt ?? data.createdAt)}</Detail>
          <Detail label="Duração">
            <span className="tabular-nums">
              {formatDuration(durationBetween(data.startedAt, finishedAt))}
            </span>
          </Detail>
          <Detail label="Imagem">
            <span className="font-mono" title={data.imageTag ?? undefined}>
              {data.imageTag ?? "—"}
            </span>
          </Detail>
          <Detail label="Contêiner">
            <span className="font-mono" title={data.containerName ?? undefined}>
              {data.containerName ?? "—"}
            </span>
          </Detail>
          {data.sourceDeploymentId == null ? null : (
            <Detail label="Imagem de">
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

      <LogViewer
        url={`/api/deployments/${deploymentId}/logs`}
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
