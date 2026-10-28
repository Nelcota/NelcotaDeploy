import { useNavigate } from "@tanstack/react-router";
import type { MouseEvent, ReactNode } from "react";

import { ListRow } from "./layout";

/** Elements whose clicks belong to themselves, not to the row. */
const INTERACTIVE_SELECTOR = "a, button, input, select, [role='dialog'], [role='alertdialog']";

/**
 * List row ({@link ListRow}) that opens a deployment when clicked anywhere. Links and buttons
 * inside keep their own behavior.
 */
export function DeploymentListRow({
  projectId,
  deploymentId,
  children,
}: {
  readonly projectId: string;
  readonly deploymentId: string;
  readonly children: ReactNode;
}) {
  const navigate = useNavigate();
  const open = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR) != null) {
      return;
    }
    void navigate({
      to: "/projects/$projectId/deployments/$deploymentId",
      params: { projectId, deploymentId },
    });
  };
  return (
    // The commit link inside the row is the keyboard path; the click target is a convenience.
    <div onClick={open} className="cursor-pointer has-[a:focus-visible]:bg-well/50">
      <ListRow>{children}</ListRow>
    </div>
  );
}
