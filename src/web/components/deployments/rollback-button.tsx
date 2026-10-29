import { LoaderCircleIcon, RotateCcwIcon } from "lucide-react";

import type { Deployment } from "@/deployments";
import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { useAction } from "@/web/components/layout/use-action";
import { Button } from "@/web/components/ui/button";
import { rollbackDeploymentFn } from "@/web/functions/deployments.functions";

/** Asks to confirm, then queues a deploy that reuses this deployment's image. */
export function RollbackButton({ deployment }: { readonly deployment: Deployment }) {
  const rollback = useAction({
    action: () =>
      rollbackDeploymentFn({
        data: { projectId: deployment.projectId, deploymentId: deployment.id },
      }),
    successMessage: "Rollback colocado na fila",
    invalidate: [
      ["deployments", deployment.projectId],
      ["project", deployment.projectId],
    ],
  });
  return (
    <ConfirmDialog
      trigger={
        <Button
          variant="ghost"
          size="sm"
          disabled={rollback.isPending}
          title="Voltar para este deploy"
        >
          {rollback.isPending ? (
            <LoaderCircleIcon aria-hidden className="animate-spin" />
          ) : (
            <RotateCcwIcon aria-hidden />
          )}
          <span className="max-sm:sr-only">Rollback</span>
        </Button>
      }
      title="Voltar para este deploy?"
      description={
        <p>
          Um novo contêiner será criado a partir da imagem{" "}
          <span className="font-mono">{deployment.imageTag ?? "—"}</span>, com as variáveis e
          domínios atuais. O contêiner atual só é removido depois que o novo passar na verificação
          de saúde.
        </p>
      }
      confirmLabel="Fazer rollback"
      onConfirm={() => rollback.mutate()}
    />
  );
}
