import { useQuery } from "@tanstack/react-query";

import { formatRelativeTime } from "@/shared/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { listDeploymentsFn } from "@/web/functions/deployments.functions";

import { ALL_DEPLOYMENTS, type DeploymentItem, LIVE_DEPLOYMENT, shortShaOf } from "./runtime-logs";

const RECENT_DEPLOYMENTS = 10;

/** Which deploy the console streams: the live one by default, a recent one, or all of them. */
export function DeploymentPicker({
  projectId,
  currentDeploymentId,
  selected,
  now,
  onChange,
}: {
  readonly projectId: string;
  readonly currentDeploymentId: string;
  readonly selected: string;
  readonly now: Date;
  readonly onChange: (deploymentId: string) => void;
}) {
  const query = useQuery({
    queryKey: ["deployments", projectId, "succeeded", currentDeploymentId],
    queryFn: () =>
      listDeploymentsFn({ data: { projectId, status: "succeeded", limit: RECENT_DEPLOYMENTS } }),
  });
  return (
    <div className="min-w-0 space-y-1">
      <Select value={selected} onValueChange={onChange}>
        <SelectTrigger
          aria-label="Deploy exibido"
          className="h-9 w-full border-0 bg-white/5 text-sm text-console-foreground ring-0"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <DeploymentOptions
            deployments={query.data ?? []}
            selected={selected}
            currentDeploymentId={currentDeploymentId}
            now={now}
          />
        </SelectContent>
      </Select>
      {query.isError ? (
        <HistoryUnavailable retrying={query.isFetching} onRetry={() => void query.refetch()} />
      ) : null}
    </div>
  );
}

function DeploymentOptions({
  deployments,
  selected,
  currentDeploymentId,
  now,
}: {
  readonly deployments: readonly DeploymentItem[];
  readonly selected: string;
  readonly currentDeploymentId: string;
  readonly now: Date;
}) {
  const missingSelection =
    selected !== LIVE_DEPLOYMENT &&
    selected !== ALL_DEPLOYMENTS &&
    deployments.every((deployment) => deployment.id !== selected);
  return (
    <>
      <SelectItem value={LIVE_DEPLOYMENT}>Acompanhar deploy no ar</SelectItem>
      {missingSelection ? (
        <SelectItem value={selected}>
          Deploy fixado · {shortShaOf({ id: selected, commitSha: null, requestedCommitSha: null })}
        </SelectItem>
      ) : null}
      {deployments.map((deployment) => (
        <SelectItem key={deployment.id} value={deployment.id}>
          <span className="font-mono">{shortShaOf(deployment)}</span>
          <span className="text-muted-foreground">
            {deployment.id === currentDeploymentId
              ? "no ar · fixar"
              : formatRelativeTime(deployment.createdAt, now)}
          </span>
        </SelectItem>
      ))}
      <SelectItem value={ALL_DEPLOYMENTS}>Todos os deploys recentes</SelectItem>
    </>
  );
}

function HistoryUnavailable({
  retrying,
  onRetry,
}: {
  readonly retrying: boolean;
  readonly onRetry: () => void;
}) {
  return (
    <p role="status" className="px-2 text-xs text-console-foreground/70">
      Histórico indisponível.{" "}
      <button
        type="button"
        disabled={retrying}
        onClick={onRetry}
        className="rounded underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-console-ring focus-visible:outline-none disabled:opacity-45"
      >
        Tentar novamente
      </button>
    </p>
  );
}
