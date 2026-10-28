import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon, OctagonXIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { durationBetween, formatDateTime, formatDuration } from "@/shared/format";
import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { DeploymentStages } from "@/web/components/deployment-stages";
import { ACTIVE_DEPLOYMENT_STATUSES, DEPLOYMENT_TRIGGER_LABELS } from "@/web/components/labels";
import { LogViewer } from "@/web/components/log-viewer";
import { PageHeader } from "@/web/components/page-header";
import { ErrorState, ListSkeleton } from "@/web/components/states";
import { DeploymentStatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
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
    <div className="min-w-0 space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{children}</dd>
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
      <div className="space-y-3">
        <Link
          to="/projects/$projectId/deployments"
          params={{ projectId }}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:underline focus-visible:outline-none"
        >
          <ArrowLeftIcon aria-hidden className="size-4" />
          Todos os deploys
        </Link>
        <PageHeader
          title={
            <span className="flex flex-wrap items-center gap-3">
              Deploy{" "}
              {sha == null ? data.id.slice(-SHORT_ID_LENGTH) : sha.slice(0, SHORT_SHA_LENGTH)}
              <DeploymentStatusBadge status={data.status} />
            </span>
          }
          description={data.commitMessage ?? "sem mensagem de commit"}
          actions={cancelButton}
        />
      </div>

      <DeploymentStages deployment={data} />

      <Card className="py-5">
        <CardContent className="space-y-4 px-5">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
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
              <span className="font-mono text-xs" title={data.imageTag ?? undefined}>
                {data.imageTag ?? "—"}
              </span>
            </Detail>
            <Detail label="Contêiner">
              <span className="font-mono text-xs" title={data.containerName ?? undefined}>
                {data.containerName ?? "—"}
              </span>
            </Detail>
            {data.sourceDeploymentId == null ? null : (
              <Detail label="Imagem reaproveitada de">
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
          {data.status === "failed" && data.errorMessage != null ? (
            <div
              role="alert"
              className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3"
            >
              <p className="text-sm font-medium text-destructive">
                O deploy falhou. A versão anterior continua no ar.
              </p>
              <p className="text-xs text-muted-foreground">Detalhe técnico</p>
              <pre className="font-mono text-xs break-all whitespace-pre-wrap">
                {data.errorMessage}
              </pre>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="text-base font-semibold">Logs do build</h2>
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
      </div>
    </section>
  );
}
