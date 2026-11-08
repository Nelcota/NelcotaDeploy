import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react";

import { shouldOfferApply } from "@/web/components/deployments/apply-changes";
import { DEPLOYMENT_STATUS_LABELS } from "@/web/components/layout/labels";
import { useAction } from "@/web/components/layout/use-action";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { Button } from "@/web/components/ui/button";
import { applyProjectChangesFn } from "@/web/functions/deployments.functions";

/**
 * Notice shown after a change that only reaches the application when its container is
 * recreated, with the button that does it.
 */
export function ApplyChangesBanner({
  message,
  state,
}: {
  readonly message: string;
  readonly state: ReturnType<typeof useApplyChanges>;
}) {
  const deployment = state.activeDeployment;
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-xl bg-warning/8 px-5 py-4 ring-1 ring-warning/25 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-2 text-sm">
        <RefreshCwIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="min-w-0 space-y-1">
          <p>{message}</p>
          <p className="text-muted-foreground">
            A aplicação usará um novo contêiner com a imagem atual e as alterações salvas, sem
            reconstruir a imagem.
          </p>
          {deployment == null ? null : (
            <p className="text-muted-foreground">
              Deploy em andamento: {DEPLOYMENT_STATUS_LABELS[deployment.status]}. Ao terminar,
              verificamos automaticamente se ainda há mudanças pendentes.
            </p>
          )}
        </div>
      </div>
      {deployment == null ? (
        <Button
          size="sm"
          disabled={state.canApply === false}
          onClick={() => state.redeploy.mutate()}
        >
          {state.redeploy.isPending ? (
            <LoaderCircleIcon aria-hidden className="animate-spin" />
          ) : null}
          Recriar contêiner com alterações
        </Button>
      ) : (
        <Button size="sm" variant="outline" asChild>
          <Link
            to="/projects/$projectId/deployments/$deploymentId"
            params={{ projectId: state.projectId, deploymentId: deployment.id }}
          >
            Ver progresso do deploy
          </Link>
        </Button>
      )}
    </div>
  );
}

/**
 * Follows pending changes and production progress through the shared project query, including
 * after navigation or reload. Failed or cancelled deployments allow another explicit attempt.
 *
 * @param projectId - Project being edited.
 * @param pending - The server's `pendingRuntimeChanges` for the project.
 * @param canRedeploy - The user may redeploy and the project has a live deployment.
 * @returns The apply action, production progress and whether the action can be offered.
 */
export function useApplyChanges(projectId: string, pending: boolean, canRedeploy: boolean) {
  const project = useQuery(projectQueryOptions(projectId));
  const activeDeployment = project.data?.activeDeployment ?? null;
  const redeploy = useAction({
    action: () => applyProjectChangesFn({ data: { projectId } }),
    successMessage: (deploymentId) =>
      deploymentId == null ? "Nada novo para aplicar" : "Mudanças colocadas na fila",
    invalidate: [["project", projectId], ["deployments"]],
  });
  const canApply = shouldOfferApply({
    pending,
    canRedeploy,
    requested: activeDeployment != null || redeploy.isPending,
  });
  return { projectId, redeploy, activeDeployment, canApply, showBanner: pending && canRedeploy };
}
