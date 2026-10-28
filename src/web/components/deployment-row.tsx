import { useNavigate } from "@tanstack/react-router";
import type { MouseEvent, ReactNode } from "react";

import { cn } from "./ui/class-names";
import { TableRow } from "./ui/table";

/** Elements whose clicks belong to themselves, not to the row. */
const INTERACTIVE_SELECTOR = "a, button, input, select, [role='dialog'], [role='alertdialog']";

/**
 * Table row that opens a deployment when clicked anywhere. Keyboard and screen-reader users
 * use the link inside the row; buttons and dialogs (which React bubbles through portals)
 * keep their own behavior.
 */
export function DeploymentRow({
  projectId,
  deploymentId,
  className,
  children,
}: {
  readonly projectId: string;
  readonly deploymentId: string;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  const navigate = useNavigate();
  const open = (event: MouseEvent<HTMLTableRowElement>) => {
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
    <TableRow onClick={open} className={cn("cursor-pointer", className)}>
      {children}
    </TableRow>
  );
}
