import { useNavigate } from "@tanstack/react-router";
import { LoaderCircleIcon, OctagonXIcon, RotateCwIcon } from "lucide-react";

import { RollbackButton } from "@/web/components/deployments/rollback-button";
import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { useAction } from "@/web/components/layout/use-action";
import { useCan } from "@/web/components/shell/use-permissions";
import { Button } from "@/web/components/ui/button";
import { cancelDeploymentFn, retryDeploymentFn } from "@/web/functions/deployments.functions";

import { headerActionOf } from "./deployment-detail";
import type { DeploymentDetailData } from "./use-deployment-detail";

/** Cancel, retry or roll back, whichever fits the deploy's state; nothing otherwise. */
export function DeploymentHeaderAction({
  projectId,
  deployment,
}: {
  readonly projectId: string;
  readonly deployment: DeploymentDetailData;
}) {
  const can = useCan();
  const action = headerActionOf(deployment, can("deployment:create"));
  if (action === "cancel") {
    return <CancelButton projectId={projectId} deployment={deployment} />;
  }
  if (action === "retry") {
    return <RetryButton projectId={projectId} deploymentId={deployment.id} />;
  }
  if (action === "rollback") {
    return <RollbackButton deployment={deployment} />;
  }
  return null;
}

function RetryButton({
  projectId,
  deploymentId,
}: {
  readonly projectId: string;
  readonly deploymentId: string;
}) {
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
  return (
    <Button size="sm" disabled={retry.isPending} onClick={() => retry.mutate()}>
      {retry.isPending ? (
        <LoaderCircleIcon aria-hidden className="animate-spin" />
      ) : (
        <RotateCwIcon aria-hidden />
      )}
      Tentar de novo
    </Button>
  );
}

function CancelButton({
  projectId,
  deployment,
}: {
  readonly projectId: string;
  readonly deployment: DeploymentDetailData;
}) {
  const cancel = useAction({
    action: () => cancelDeploymentFn({ data: { deploymentId: deployment.id } }),
    successMessage: (result) =>
      result === "cancelling"
        ? "Cancelamento solicitado; o worker vai parar no próximo passo"
        : "Deploy cancelado",
    invalidate: [
      ["deployment", deployment.id],
      ["deployments", projectId],
    ],
  });
  const cancelRequested = deployment.cancelRequestedAt != null;
  return (
    <ConfirmDialog
      trigger={
        <Button variant="destructive" size="sm" disabled={cancel.isPending || cancelRequested}>
          <OctagonXIcon aria-hidden />
          {cancelRequested ? "Cancelando…" : "Cancelar deploy"}
        </Button>
      }
      title="Cancelar este deploy?"
      description="A versão atual continua no ar. Se o deploy já estiver em andamento, ele para no próximo passo e o contêiner novo é removido."
      confirmLabel="Cancelar deploy"
      cancelLabel="Continuar deploy"
      destructive
      onConfirm={() => cancel.mutate()}
    />
  );
}
