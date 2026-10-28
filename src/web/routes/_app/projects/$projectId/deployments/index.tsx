import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { RocketIcon, RotateCcwIcon } from "lucide-react";
import { useMemo } from "react";

import type { Deployment } from "@/deployments";
import {
  durationBetween,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
} from "@/shared/format";
import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { ACTIVE_DEPLOYMENT_STATUSES, DEPLOYMENT_TRIGGER_LABELS } from "@/web/components/labels";
import { projectQueryOptions } from "@/web/components/project-query";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/states";
import { DeploymentStatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";
import { useAction } from "@/web/components/use-action";
import { useCan } from "@/web/components/use-permissions";
import {
  listDeploymentsFn,
  listRollbackCandidatesFn,
  rollbackDeploymentFn,
} from "@/web/functions/deployments.functions";

const PAGE_SIZE = 25;
const ACTIVE_REFRESH_INTERVAL_IN_MS = 5000;
const SHORT_SHA_LENGTH = 7;

export const Route = createFileRoute("/_app/projects/$projectId/deployments/")({
  head: () => ({ meta: [{ title: "Deploys · Nelcota Deploy" }] }),
  component: ProjectDeploymentsPage,
});

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, Deployment>();

function RollbackButton({ deployment }: { readonly deployment: Deployment }) {
  const rollback = useAction({
    action: () =>
      rollbackDeploymentFn({
        data: { projectId: deployment.projectId, deploymentId: deployment.id },
      }),
    successMessage: "Rollback colocado na fila",
    invalidate: [
      ["deployments", deployment.projectId],
      ["project", deployment.projectId],
    ],
  });
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm" disabled={rollback.isPending}>
          <RotateCcwIcon aria-hidden />
          Rollback
        </Button>
      }
      title="Voltar para este deploy?"
      description={
        <p>
          Um novo contêiner será criado a partir da imagem{" "}
          <span className="font-mono">{deployment.imageTag ?? "—"}</span>, com as variáveis e
          domínios atuais. O contêiner atual só é removido depois que o novo passar na verificação
          de saúde.
        </p>
      }
      confirmLabel="Fazer rollback"
      onConfirm={() => rollback.mutate()}
    />
  );
}

function ProjectDeploymentsPage() {
  const { projectId } = Route.useParams();
  const can = useCan();
  const project = useQuery(projectQueryOptions(projectId));
  const candidates = useQuery({
    queryKey: ["rollback-candidates", projectId],
    queryFn: () => listRollbackCandidatesFn({ data: { projectId } }),
  });
  const deployments = useInfiniteQuery({
    queryKey: ["deployments", projectId],
    queryFn: ({ pageParam }) =>
      listDeploymentsFn({
        data: { projectId, limit: PAGE_SIZE, ...(pageParam == null ? {} : { before: pageParam }) },
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

  const rollbackIds = useMemo(
    () => new Set((candidates.data ?? []).map((candidate) => candidate.id)),
    [candidates.data],
  );
  const currentDeploymentId = project.data?.project.currentDeploymentId ?? null;
  const canRollback = can("deployment:create");
  const rows = useMemo(() => deployments.data?.pages.flat() ?? [], [deployments.data]);

  const columns = useMemo(() => {
    const now = new Date();
    return helper.columns([
      helper.accessor("status", {
        header: "Status",
        cell: (info) => <DeploymentStatusBadge status={info.getValue()} />,
      }),
      helper.display({
        id: "commit",
        header: "Commit",
        cell: (info) => <CommitCell deployment={info.row.original} />,
      }),
      helper.accessor("branch", {
        header: "Branch",
        cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
      }),
      helper.display({
        id: "trigger",
        header: "Origem",
        cell: (info) => (
          <div className="text-xs">
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
            className="text-xs"
          >
            {formatRelativeTime(info.getValue(), now)}
          </time>
        ),
      }),
      helper.display({
        id: "duration",
        header: "Duração",
        cell: (info) => (
          <span className="text-xs tabular-nums">
            {formatDuration(
              durationBetween(info.row.original.startedAt, info.row.original.finishedAt),
            )}
          </span>
        ),
      }),
      helper.display({
        id: "actions",
        header: () => <span className="sr-only">Ações</span>,
        cell: (info) => {
          const deployment = info.row.original;
          const offerRollback =
            canRollback && rollbackIds.has(deployment.id) && deployment.id !== currentDeploymentId;
          return (
            <div className="flex justify-end gap-2">
              {offerRollback ? <RollbackButton deployment={deployment} /> : null}
              <Button variant="ghost" size="sm" asChild>
                <Link
                  to="/projects/$projectId/deployments/$deploymentId"
                  params={{ projectId: deployment.projectId, deploymentId: deployment.id }}
                >
                  Detalhes
                </Link>
              </Button>
            </div>
          );
        },
      }),
    ]);
  }, [canRollback, rollbackIds, currentDeploymentId]);

  const table = useTable({ features, columns, data: rows });

  if (deployments.isError) {
    return <ErrorState error={deployments.error} onRetry={() => void deployments.refetch()} />;
  }
  if (deployments.isPending) {
    return <ListSkeleton rows={6} />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={RocketIcon}
        title="Nenhum deploy ainda"
        description="Use o botão Deploy no topo da página para publicar a primeira versão."
      />
    );
  }

  return (
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
              <TableRow
                key={row.id}
                className={row.original.id === currentDeploymentId ? "bg-muted/40" : undefined}
              >
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
  );
}

function CommitCell({ deployment }: { readonly deployment: Deployment }) {
  const sha = deployment.commitSha ?? deployment.requestedCommitSha;
  return (
    <div className="max-w-72 min-w-0 text-xs">
      <p className="font-mono">{sha == null ? "—" : sha.slice(0, SHORT_SHA_LENGTH)}</p>
      <p className="truncate text-muted-foreground" title={deployment.commitMessage ?? undefined}>
        {deployment.commitMessage ?? "sem mensagem"}
      </p>
    </div>
  );
}
