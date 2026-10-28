import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { redeployProjectFn } from "@/web/functions/deployments.functions";

import { Button } from "./ui/button";
import { useAction } from "./use-action";

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
  useEffect(() => {
    if (pending === false) {
      setRequested(false);
    }
  }, [pending]);
  const redeploy = useAction({
    action: () => redeployProjectFn({ data: { projectId } }),
    successMessage: "Redeploy colocado na fila",
    invalidate: [["project", projectId], ["deployments"]],
    onSuccess: () => setRequested(true),
  });
  return { redeploy, showBanner: pending && canRedeploy && requested === false };
}
