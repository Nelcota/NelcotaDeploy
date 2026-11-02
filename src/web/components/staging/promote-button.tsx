import { ArrowUpFromLineIcon } from "lucide-react";

import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { Button } from "@/web/components/ui/button";

import { usePromoteStaging } from "./use-staging";

/** Header action of a staging project: deploys its live commit to production, after confirming. */
export function PromoteButton({
  stagingProjectId,
  productionProjectId,
  commitSha,
}: {
  readonly stagingProjectId: string;
  readonly productionProjectId: string;
  /** Commit live on staging; the button is disabled without one. */
  readonly commitSha: string | null;
}) {
  const promote = usePromoteStaging(stagingProjectId, productionProjectId);
  const shortSha = commitSha?.slice(0, 7) ?? "";
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" disabled={commitSha == null || promote.isPending}>
          <ArrowUpFromLineIcon aria-hidden />
          Promover para produção
        </Button>
      }
      title="Promover para produção?"
      description={`A produção faz um novo deploy do commit ${shortSha}, que está no ar no staging, com as variáveis de produção.`}
      confirmLabel="Promover"
      onConfirm={() => promote.mutate()}
    />
  );
}
