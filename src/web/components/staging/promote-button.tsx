import { ArrowUpFromLineIcon } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { Button } from "@/web/components/ui/button";

import { usePromoteStaging } from "./use-staging";

const DISPLAYED_SHA_LENGTH = 7;

type PromotionSelection = {
  readonly deploymentId: string;
  readonly commitSha: string;
};

/** Header action of a staging project: deploys its live commit to production, after confirming. */
export function PromoteButton({
  stagingProjectId,
  productionProjectId,
  deploymentId,
  commitSha,
}: {
  readonly stagingProjectId: string;
  readonly productionProjectId: string;
  readonly deploymentId: string | null;
  /** Commit live on staging; the button is disabled without one. */
  readonly commitSha: string | null;
}) {
  const promote = usePromoteStaging(stagingProjectId, productionProjectId);
  const [selection, setSelection] = useState<PromotionSelection | null>(null);
  const shortSha = selection?.commitSha.slice(0, DISPLAYED_SHA_LENGTH) ?? "";
  return (
    <ConfirmDialog
      open={selection != null}
      onOpenChange={(open) => {
        if (open === false) {
          setSelection(null);
          return;
        }
        if (deploymentId == null || commitSha == null) {
          return;
        }
        // Polling may update the project while the user reads the confirmation.
        setSelection({ deploymentId, commitSha });
      }}
      trigger={
        <Button
          variant="outline"
          disabled={deploymentId == null || commitSha == null || promote.isPending}
        >
          <ArrowUpFromLineIcon aria-hidden />
          Promover para produção
        </Button>
      }
      title="Promover para produção?"
      description={`A produção faz um novo deploy do commit ${shortSha}, que está no ar no staging, com as variáveis de produção.`}
      confirmLabel="Promover"
      onConfirm={() => {
        if (selection == null) {
          throw new Error("Cannot promote staging without a confirmed deployment");
        }
        promote.mutate(selection.deploymentId);
      }}
    />
  );
}
