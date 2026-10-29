import { Link } from "@tanstack/react-router";
import { GitBranchIcon } from "lucide-react";

import {
  DeploymentListRow,
  DeploymentMobileMeta,
  DeploymentOriginColumn,
  DeploymentTimingColumn,
} from "@/web/components/deployments/deployment-row";
import { RollbackButton } from "@/web/components/deployments/rollback-button";
import { LiveBadge } from "@/web/components/layout/layout";
import { DeploymentStatusBadge } from "@/web/components/layout/status-badge";

import { deploymentLabel } from "../deployment-history";
import type { DeploymentItem } from "../use-deployment-history";

/** One deploy of the project history: commit, origin, timing, rollback and status. */
export function ProjectDeploymentRow({
  deployment,
  current,
  rollback,
}: {
  readonly deployment: DeploymentItem;
  readonly current: boolean;
  /** "hidden" drops the rollback column; "empty" keeps it for alignment without a button. */
  readonly rollback: "hidden" | "empty" | "available";
}) {
  return (
    <DeploymentListRow projectId={deployment.projectId} deploymentId={deployment.id}>
      <CommitCell deployment={deployment} current={current} />
      <DeploymentOriginColumn
        trigger={deployment.trigger}
        triggeredBy={deployment.triggeredByLabel}
      />
      <DeploymentTimingColumn timing={deployment} />
      {rollback === "hidden" ? null : (
        <div className="flex shrink-0 justify-end sm:w-28">
          {rollback === "available" ? <RollbackButton deployment={deployment} /> : null}
        </div>
      )}
      <div className="flex shrink-0 justify-end sm:w-32">
        <DeploymentStatusBadge status={deployment.status} />
      </div>
    </DeploymentListRow>
  );
}

function CommitCell({
  deployment,
  current,
}: {
  readonly deployment: DeploymentItem;
  readonly current: boolean;
}) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex min-w-0 items-center gap-2.5">
        <Link
          to="/projects/$projectId/deployments/$deploymentId"
          params={{ projectId: deployment.projectId, deploymentId: deployment.id }}
          className="shrink-0 rounded-sm font-mono text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {deploymentLabel(deployment)}
        </Link>
        <span
          className="inline-flex min-w-0 items-center gap-1 font-mono text-xs text-muted-foreground"
          title={deployment.branch}
        >
          <GitBranchIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{deployment.branch}</span>
        </span>
        {current ? <LiveBadge /> : null}
      </div>
      <p
        className="truncate text-sm text-muted-foreground"
        title={deployment.commitMessage ?? undefined}
      >
        {deployment.commitMessage ?? "sem mensagem"}
      </p>
      <DeploymentMobileMeta timing={deployment} />
    </div>
  );
}
