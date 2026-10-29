import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { shouldOfferApply } from "@/web/components/deployments/apply-changes";
import { useAction } from "@/web/components/layout/use-action";
import { Button } from "@/web/components/ui/button";
import { redeployProjectFn } from "@/web/functions/deployments.functions";

/**
 * Notice shown after a change that only reaches the application when its container is
 * recreated, with the button that does it.
 */
export function ApplyChangesBanner({
  message,
  applying,
  onApply,
}: {
  readonly message: string;
  readonly applying: boolean;
  readonly onApply: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-xl bg-warning/8 px-5 py-4 ring-1 ring-warning/25 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="flex items-start gap-2 text-sm">
        <RefreshCwIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
        {message}
      </p>
      <Button size="sm" disabled={applying} onClick={onApply}>
        {applying ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
        Aplicar agora
      </Button>
    </div>
  );
}

/**
 * Redeploy action plus whether to offer it: the server reports changes not yet applied, and
 * once a redeploy is queued the offer waits until the new container clears them.
 *
 * @param projectId - Project being edited.
 * @param pending - The server's `pendingRuntimeChanges` for the project.
 * @param canRedeploy - The user may redeploy and the project has a live deployment.
 * @returns The redeploy action and whether to show the banner.
 */
export function useApplyChanges(projectId: string, pending: boolean, canRedeploy: boolean) {
  const [requested, setRequested] = useState(false);
  // Adjusts state during render when `pending` changes, as React recommends over an effect.
  const [previousPending, setPreviousPending] = useState(pending);
  if (pending !== previousPending) {
    setPreviousPending(pending);
    if (pending === false) {
      setRequested(false);
    }
  }
  const redeploy = useAction({
    action: () => redeployProjectFn({ data: { projectId } }),
    successMessage: "Redeploy colocado na fila",
    invalidate: [["project", projectId], ["deployments"]],
    onSuccess: () => setRequested(true),
  });
  return { redeploy, showBanner: shouldOfferApply({ pending, canRedeploy, requested }) };
}
