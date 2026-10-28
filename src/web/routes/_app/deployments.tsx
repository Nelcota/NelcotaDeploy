import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import type { DeploymentStatus } from "@/deployments";
import {
  durationBetween,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
} from "@/shared/format";
import { DeploymentListRow } from "@/web/components/deployment-row";
import {
  ACTIVE_DEPLOYMENT_STATUSES,
  DEPLOYMENT_STATUS_LABELS,
  DEPLOYMENT_TRIGGER_LABELS,
} from "@/web/components/labels";
import { List, ListRow } from "@/web/components/layout";
import { PageHeader } from "@/web/components/page-header";
import { ErrorState } from "@/web/components/states";
import { DeploymentStatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Skeleton } from "@/web/components/ui/skeleton";
import { listDeploymentsFn } from "@/web/functions/deployments.functions";

const PAGE_SIZE = 25;
const ACTIVE_REFRESH_INTERVAL_IN_MS = 5000;
const SHORT_SHA_LENGTH = 7;
const ALL_STATUSES = "all";
// Status values come from the labels map: importing them from the server package would pull
// database code into the browser bundle.
const STATUS_OPTIONS = Object.keys(DEPLOYMENT_STATUS_LABELS) as DeploymentStatus[];

export const Route = createFileRoute("/_app/deployments")({
  head: () => ({ meta: [{ title: "Deploys · Nelcota Deploy" }] }),
  component: DeploymentsPage,
});

function isDeploymentStatus(value: string): value is DeploymentStatus {
  return STATUS_OPTIONS.some((status) => status === value);
}

function DeploymentsPage() {
  const [statusFilter, setStatusFilter] = useState<string>(ALL_STATUSES);
  const status = isDeploymentStatus(statusFilter) ? statusFilter : undefined;
  const deployments = useInfiniteQuery({
    queryKey: ["deployments", "all", status ?? ALL_STATUSES],
    queryFn: ({ pageParam }) =>
      listDeploymentsFn({
        data: {
          limit: PAGE_SIZE,
          ...(status == null ? {} : { status }),
          ...(pageParam == null ? {} : { before: pageParam }),
        },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.length < PAGE_SIZE ? undefined : (lastPage.at(-1)?.createdAt ?? undefined),
    refetchInterval: (query) => {
      const rows = query.state.data?.pages.flat() ?? [];
      return rows.some((row) => ACTIVE_DEPLOYMENT_STATUSES.has(row.status))
        ? ACTIVE_REFRESH_INTERVAL_IN_MS
        : false;
    },
  });
  const rows = useMemo(() => deployments.data?.pages.flat() ?? [], [deployments.data]);
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Deploys"
        description="Histórico de deploys de todos os projetos."
        actions={
          <>
            <Label htmlFor="status-filter" className="sr-only">
              Filtrar por status
            </Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger id="status-filter" size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STATUSES}>Todos os status</SelectItem>
                {STATUS_OPTIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {DEPLOYMENT_STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />
      {deployments.isError ? (
        <ErrorState error={deployments.error} onRetry={() => void deployments.refetch()} />
      ) : null}
      {deployments.isPending ? <Skeleton className="h-96 rounded-xl" /> : null}
      {deployments.isSuccess ? (
        <section aria-label="Histórico de deploys" className="space-y-4">
          <List>
            {rows.length === 0 ? (
              <ListRow>
                <p className="text-sm text-muted-foreground">
                  {status == null
                    ? "Nenhum deploy ainda. Eles aparecem aqui assim que forem solicitados."
                    : "Nenhum deploy com este status."}
                </p>
              </ListRow>
            ) : null}
            {rows.map((deployment) => {
              const sha = deployment.commitSha ?? deployment.requestedCommitSha;
              return (
                <DeploymentListRow
                  key={deployment.id}
                  projectId={deployment.projectId}
                  deploymentId={deployment.id}
                  status={deployment.status}
                >
                  <div className="hidden w-36 shrink-0 sm:block">
                    <DeploymentStatusBadge status={deployment.status} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-baseline gap-2">
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: deployment.projectId }}
                        className="truncate font-medium underline-offset-4 hover:underline"
                      >
                        {deployment.projectName}
                      </Link>
                      <Link
                        to="/projects/$projectId/deployments/$deploymentId"
                        params={{ projectId: deployment.projectId, deploymentId: deployment.id }}
                        className="shrink-0 font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                      >
                        {sha == null
                          ? `deploy ${deployment.id.slice(-SHORT_SHA_LENGTH)}`
                          : sha.slice(0, SHORT_SHA_LENGTH)}
                      </Link>
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {deployment.commitMessage ?? "sem mensagem"}
                    </p>
                    {/* Small screens drop the status column; the status moves under the commit. */}
                    <div className="pt-1.5 sm:hidden">
                      <DeploymentStatusBadge status={deployment.status} />
                    </div>
                  </div>
                  <div className="hidden w-40 shrink-0 text-xs md:block">
                    <p className="font-mono text-muted-foreground">{deployment.branch}</p>
                    <p className="truncate text-faint">
                      {DEPLOYMENT_TRIGGER_LABELS[deployment.trigger]} ·{" "}
                      {deployment.triggeredByLabel}
                    </p>
                  </div>
                  <div className="w-20 shrink-0 text-right text-xs sm:w-28">
                    <time
                      dateTime={deployment.createdAt}
                      title={formatDateTime(deployment.createdAt)}
                      className="block text-muted-foreground"
                    >
                      {formatRelativeTime(deployment.createdAt, now)}
                    </time>
                    <span className="text-faint tabular-nums">
                      {formatDuration(durationBetween(deployment.startedAt, deployment.finishedAt))}
                    </span>
                  </div>
                </DeploymentListRow>
              );
            })}
          </List>
          {deployments.hasNextPage ? (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={deployments.isFetchingNextPage}
                onClick={() => void deployments.fetchNextPage()}
              >
                {deployments.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
