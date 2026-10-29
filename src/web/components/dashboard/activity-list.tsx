import { Link } from "@tanstack/react-router";
import { HistoryIcon } from "lucide-react";

import { formatRelativeTime } from "@/shared/format";
import { useNow } from "@/web/components/clock/use-now";
import { EmptyState } from "@/web/components/layout/states";
import { DeploymentStatusBadge } from "@/web/components/layout/status-badge";

import type { DashboardSummary } from "./dashboard";

const SHORT_SHA_LENGTH = 7;

type RecentDeployment = DashboardSummary["recentDeployments"][number];

/** Recent deploys, newest first, or a note when the chosen view has none. */
export function ActivityList({
  deployments,
  view,
}: {
  readonly deployments: readonly RecentDeployment[];
  readonly view: "recent" | "failed";
}) {
  const now = useNow();
  if (deployments.length === 0) {
    return (
      <EmptyState
        icon={HistoryIcon}
        title={view === "recent" ? "Nenhum deploy ainda" : "Nenhuma falha nas últimas 24 horas"}
      />
    );
  }
  return (
    <ul className="-mx-2 max-h-80 divide-y divide-border overflow-y-auto">
      {deployments.map((deployment) => (
        <ActivityRow key={deployment.id} deployment={deployment} now={now} />
      ))}
    </ul>
  );
}

function ActivityRow({
  deployment,
  now,
}: {
  readonly deployment: RecentDeployment;
  readonly now: Date;
}) {
  const sha = deployment.commitSha?.slice(0, SHORT_SHA_LENGTH) ?? "—";
  return (
    <li>
      <Link
        to="/projects/$projectId/deployments/$deploymentId"
        params={{ projectId: deployment.projectId, deploymentId: deployment.id }}
        className="flex items-start justify-between gap-4 px-2 py-3 transition-colors hover:bg-well/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{deployment.projectName}</span>
          <span className="block truncate text-xs text-muted-foreground">
            <span className="font-mono">{sha}</span> · {deployment.commitMessage ?? "sem mensagem"}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <DeploymentStatusBadge status={deployment.status} />
          <time dateTime={deployment.createdAt} className="text-xs text-faint">
            {formatRelativeTime(deployment.createdAt, now)}
          </time>
        </span>
      </Link>
    </li>
  );
}
