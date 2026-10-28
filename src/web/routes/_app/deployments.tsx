import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { RocketIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type { Deployment, DeploymentStatus } from "@/deployments";
import {
  durationBetween,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
} from "@/shared/format";
import {
  ACTIVE_DEPLOYMENT_STATUSES,
  DEPLOYMENT_STATUS_LABELS,
  DEPLOYMENT_TRIGGER_LABELS,
} from "@/web/components/labels";
import { PageHeader } from "@/web/components/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/states";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";
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

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, Deployment>();

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

  const columns = useMemo(() => {
    const now = new Date();
    return helper.columns([
      helper.accessor("status", {
        header: "Status",
        cell: (info) => <DeploymentStatusBadge status={info.getValue()} />,
      }),
      helper.display({
        id: "project",
        header: "Projeto",
        cell: (info) => (
          <Link
            to="/projects/$projectId"
            params={{ projectId: info.row.original.projectId }}
            className="font-medium underline-offset-4 hover:underline"
          >
            {info.row.original.projectName}
          </Link>
        ),
      }),
      helper.display({
        id: "commit",
        header: "Commit",
        cell: (info) => {
          const deployment = info.row.original;
          const sha = deployment.commitSha ?? deployment.requestedCommitSha;
          return (
            <div className="max-w-64 min-w-0 text-[0.82rem]">
              <p className="font-mono">{sha == null ? "—" : sha.slice(0, SHORT_SHA_LENGTH)}</p>
              <p className="truncate text-muted-foreground">
                {deployment.commitMessage ?? "sem mensagem"}
              </p>
            </div>
          );
        },
      }),
      helper.accessor("branch", {
        header: "Branch",
        cell: (info) => <span className="font-mono text-[0.82rem]">{info.getValue()}</span>,
      }),
      helper.display({
        id: "trigger",
        header: "Origem",
        cell: (info) => (
          <div className="text-[0.82rem]">
            <p>{DEPLOYMENT_TRIGGER_LABELS[info.row.original.trigger]}</p>
            <p className="text-muted-foreground">{info.row.original.triggeredByLabel}</p>
          </div>
        ),
      }),
      helper.accessor("createdAt", {
        header: "Criado",
        cell: (info) => (
          <time
            dateTime={info.getValue()}
            title={formatDateTime(info.getValue())}
            className="text-[0.82rem]"
          >
            {formatRelativeTime(info.getValue(), now)}
          </time>
        ),
      }),
      helper.display({
        id: "duration",
        header: "Duração",
        cell: (info) => (
          <span className="text-[0.82rem] tabular-nums">
            {formatDuration(
              durationBetween(info.row.original.startedAt, info.row.original.finishedAt),
            )}
          </span>
        ),
      }),
      helper.display({
        id: "actions",
        header: () => <span className="sr-only">Ações</span>,
        cell: (info) => (
          <Button variant="ghost" size="sm" asChild>
            <Link
              to="/projects/$projectId/deployments/$deploymentId"
              params={{
                projectId: info.row.original.projectId,
                deploymentId: info.row.original.id,
              }}
            >
              Detalhes
            </Link>
          </Button>
        ),
      }),
    ]);
  }, []);

  const table = useTable({ features, columns, data: rows });

  return (
    <>
      <PageHeader
        title="Deploys"
        description="Histórico de deploys de todos os projetos."
        actions={
          <div className="flex items-center gap-2">
            <Label htmlFor="status-filter" className="sr-only">
              Filtrar por status
            </Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger id="status-filter" className="w-48">
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
          </div>
        }
      />
      {deployments.isError ? (
        <ErrorState error={deployments.error} onRetry={() => void deployments.refetch()} />
      ) : null}
      {deployments.isPending ? <ListSkeleton rows={8} /> : null}
      {deployments.isSuccess && rows.length === 0 ? (
        <EmptyState
          icon={RocketIcon}
          title="Nenhum deploy encontrado"
          description={
            status == null
              ? "Os deploys aparecem aqui assim que forem solicitados."
              : "Nenhum deploy com este status."
          }
        />
      ) : null}
      {rows.length > 0 ? (
        <section aria-label="Histórico de deploys" className="space-y-4">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id}>
                    {group.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getAllCells().map((cell) => (
                      <TableCell key={cell.id}>
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
