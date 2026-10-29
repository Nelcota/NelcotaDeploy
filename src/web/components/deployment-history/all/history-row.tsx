import { Link } from "@tanstack/react-router";
import { GitBranchIcon } from "lucide-react";

import {
  DeploymentListRow,
  DeploymentMobileMeta,
  DeploymentOriginColumn,
  DeploymentTimingColumn,
} from "@/web/components/deployments/deployment-row";
import { LiveBadge } from "@/web/components/layout/layout";
import { DeploymentStatusBadge } from "@/web/components/layout/status-badge";

import { deploymentLabel } from "../deployment-history";
import type { DeploymentItem } from "../use-deployment-history";

/** One deploy of the global history: project, commit, branch, origin, timing and status. */
export function HistoryRow({ deployment }: { readonly deployment: DeploymentItem }) {
  const shortSha = deploymentLabel(deployment);
  return (
    <DeploymentListRow projectId={deployment.projectId} deploymentId={deployment.id}>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex min-w-0 items-baseline gap-2">
          <Link
            to="/projects/$projectId/deployments/$deploymentId"
            params={{ projectId: deployment.projectId, deploymentId: deployment.id }}
            aria-label={`Deploy ${shortSha} de ${deployment.projectName}`}
            className="truncate rounded-sm text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {deployment.projectName}
          </Link>
          <span className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline">
            {shortSha}
          </span>
          {deployment.isLive ? <LiveBadge /> : null}
        </p>
        <p
          className="truncate text-sm text-muted-foreground"
          title={deployment.commitMessage ?? undefined}
        >
          {deployment.commitMessage ?? "sem mensagem"}
        </p>
        <DeploymentMobileMeta shortSha={shortSha} timing={deployment} />
      </div>
      <span className="hidden w-36 shrink-0 items-center gap-1.5 truncate font-mono text-xs text-muted-foreground lg:inline-flex">
        <GitBranchIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{deployment.branch}</span>
      </span>
      <DeploymentOriginColumn
        trigger={deployment.trigger}
        triggeredBy={deployment.triggeredByLabel}
      />
      <DeploymentTimingColumn timing={deployment} />
      <div className="flex shrink-0 justify-end sm:w-32">
        <DeploymentStatusBadge status={deployment.status} />
      </div>
    </DeploymentListRow>
  );
}
