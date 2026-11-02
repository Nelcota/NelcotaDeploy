import { useNavigate } from "@tanstack/react-router";

import type { StagingInput } from "@/shared/schemas/staging.schema";
import { useAction } from "@/web/components/layout/use-action";
import { createStagingFn, promoteStagingFn } from "@/web/functions/staging/staging.functions";

/** Creates the staging environment of a production project, then opens it. */
export function useCreateStaging(productionProjectId: string) {
  const navigate = useNavigate();
  return useAction({
    action: (input: StagingInput) =>
      createStagingFn({ data: { projectId: productionProjectId, staging: input } }),
    successMessage: "Ambiente de staging criado",
    invalidate: [["project", productionProjectId], ["projects"]],
    onSuccess: async ({ stagingProjectId }) => {
      await navigate({ to: "/projects/$projectId", params: { projectId: stagingProjectId } });
    },
  });
}

/** Deploys the live staging commit to production, then opens the production deploys. */
export function usePromoteStaging(stagingProjectId: string, productionProjectId: string) {
  const navigate = useNavigate();
  return useAction({
    action: () => promoteStagingFn({ data: { projectId: stagingProjectId } }),
    successMessage: "Promoção colocada na fila",
    invalidate: [["project", productionProjectId], ["deployments"]],
    onSuccess: async () => {
      await navigate({
        to: "/projects/$projectId/deployments",
        params: { projectId: productionProjectId },
      });
    },
  });
}
