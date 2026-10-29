import { Link } from "@tanstack/react-router";

import { formatRelativeTime } from "@/shared/format";
import { useNow } from "@/web/components/clock/use-now";
import {
  DEPLOYMENT_TRIGGER_ICONS,
  DEPLOYMENT_TRIGGER_LABELS,
} from "@/web/components/layout/labels";
import { DeploymentStatusBadge } from "@/web/components/layout/status-badge";

import type { RecentDeployment } from "./use-recent-deployments";

const SHORT_SHA_LENGTH = 7;

/** One deployment: commit, who triggered it, status and age. */
export function RecentDeploymentItem({
  projectId,
  deployment,
}: {
  readonly projectId: string;
  readonly deployment: RecentDeployment;
}) {
  const now = useNow();
  return (
    <Link
      to="/projects/$projectId/deployments/$deploymentId"
      params={{ projectId, deploymentId: deployment.id }}
      className="flex items-start justify-between gap-4 px-2 py-3 transition-colors hover:bg-well/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm">
          <span className="font-mono font-medium">
            {deployment.commitSha?.slice(0, SHORT_SHA_LENGTH) ?? "—"}
          </span>{" "}
          {deployment.commitMessage ?? "sem mensagem"}
        </span>
        <TriggerLine trigger={deployment.trigger} triggeredBy={deployment.triggeredByLabel} />
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <DeploymentStatusBadge status={deployment.status} />
        <time dateTime={deployment.createdAt} className="text-xs text-faint">
          {formatRelativeTime(deployment.createdAt, now)}
        </time>
      </span>
    </Link>
  );
}

function TriggerLine({
  trigger,
  triggeredBy,
}: {
  readonly trigger: RecentDeployment["trigger"];
  readonly triggeredBy: string;
}) {
  const TriggerIcon = DEPLOYMENT_TRIGGER_ICONS[trigger];
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <TriggerIcon aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">
        {DEPLOYMENT_TRIGGER_LABELS[trigger]} · {triggeredBy}
      </span>
    </span>
  );
}
