import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  BoxesIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { DeploymentStatus } from "@/deployments";
import { formatRelativeTime } from "@/shared/format";
import { DEPLOYMENT_STATUS_LABELS } from "@/web/components/labels";
import { PageHeader } from "@/web/components/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/states";
import {
  ContainerStateBadge,
  DeploymentStatusBadge,
  StatusPill,
} from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
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
import { useCan } from "@/web/components/use-permissions";
import { listProjectsFn } from "@/web/functions/projects.functions";

const SEARCH_DEBOUNCE_IN_MS = 300;
const REFRESH_INTERVAL_IN_MS = 10_000;

export const Route = createFileRoute("/_app/projects/")({
  head: () => ({ meta: [{ title: "Projetos · Nelcota Deploy" }] }),
  component: ProjectsPage,
});

type ProjectRow = Awaited<ReturnType<typeof listProjectsFn>>[number];

const STATUS_FILTERS = {
  all: "Todos",
  online: "Online",
  offline: "Offline",
  never: "Sem deploy",
  pending: "Aguardando aprovação",
} as const;

type StatusFilter = keyof typeof STATUS_FILTERS;

function isDeploymentStatus(status: string): status is DeploymentStatus {
  return Object.hasOwn(DEPLOYMENT_STATUS_LABELS, status);
}

function isStatusFilter(value: string): value is StatusFilter {
  return Object.hasOwn(STATUS_FILTERS, value);
}

function matchesFilter(project: ProjectRow, filter: StatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "online":
      return project.containerState === "running";
    case "offline":
      return project.currentDeploymentId != null && project.containerState !== "running";
    case "never":
      return project.currentDeploymentId == null;
    case "pending":
      return project.deploymentsApproved === false;
  }
}

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, ProjectRow>();

function useColumns(now: Date) {
  return useMemo(
    () =>
      helper.columns([
        helper.display({
          id: "name",
          header: "Projeto",
          cell: ({ row }) => (
            <div className="min-w-0">
              <p className="font-medium">{row.original.name}</p>
              <p className="font-mono text-xs text-muted-foreground">{row.original.slug}</p>
            </div>
          ),
        }),
        helper.display({
          id: "repository",
          header: "Repositório",
          cell: ({ row }) => (
            <div className="min-w-0 text-sm">
              <p className="truncate">{row.original.repositoryFullName}</p>
              <p className="font-mono text-xs text-muted-foreground">{row.original.branch}</p>
            </div>
          ),
        }),
        helper.display({
          id: "container",
          header: "Contêiner",
          cell: ({ row }) =>
            row.original.deploymentsApproved ? (
              <ContainerStateBadge
                state={row.original.containerState}
                health={row.original.containerHealth}
              />
            ) : (
              <StatusPill tone="warning" label="Aguardando aprovação" />
            ),
        }),
        helper.display({
          id: "latestDeployment",
          header: "Último deploy",
          cell: ({ row }) => {
            const latest = row.original.latestDeployment;
            if (latest == null || isDeploymentStatus(latest.status) === false) {
              return <span className="text-sm text-muted-foreground">Nenhum</span>;
            }
            return (
              <div className="flex flex-col items-start gap-1">
                <DeploymentStatusBadge status={latest.status} />
                <span className="text-xs text-muted-foreground">
                  {formatRelativeTime(latest.createdAt, now)}
                </span>
              </div>
            );
          },
        }),
        helper.display({
          id: "autoDeploy",
          header: "Deploy",
          cell: ({ row }) =>
            row.original.autoDeploy ? (
              <StatusPill tone="success" label="Automático" />
            ) : (
              <StatusPill tone="neutral" label="Manual" />
            ),
        }),
      ]),
    [now],
  );
}

function useDebouncedValue(value: string, delayInMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayInMs);
    return () => clearTimeout(timer);
  }, [value, delayInMs]);
  return debounced;
}

const NO_PROJECTS: ProjectRow[] = [];

type SortKey = "name" | "latestDeployment";
type SortState = { readonly key: SortKey; readonly direction: "ascending" | "descending" };

const SORT_LABELS: Record<SortKey, string> = { name: "Projeto", latestDeployment: "Último deploy" };

function isSortKey(id: string): id is SortKey {
  return Object.hasOwn(SORT_LABELS, id);
}

/**
 * Orders projects by name or by the time of their latest deployment (projects never deployed
 * go last in both directions).
 */
function sortProjects(projects: readonly ProjectRow[], sort: SortState): ProjectRow[] {
  const sign = sort.direction === "ascending" ? 1 : -1;
  return projects.toSorted((left, right) => {
    if (sort.key === "name") {
      return sign * left.name.localeCompare(right.name, "pt-BR");
    }
    const leftTime = left.latestDeployment?.createdAt ?? null;
    const rightTime = right.latestDeployment?.createdAt ?? null;
    if (leftTime == null || rightTime == null) {
      return Number(leftTime == null) - Number(rightTime == null);
    }
    return sign * leftTime.localeCompare(rightTime);
  });
}

function SortButton({
  sortKey,
  sort,
  onSort,
}: {
  readonly sortKey: SortKey;
  readonly sort: SortState;
  readonly onSort: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  let Icon = ArrowUpDownIcon;
  if (active) {
    Icon = sort.direction === "ascending" ? ArrowUpIcon : ArrowDownIcon;
  }
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className="-ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      {SORT_LABELS[sortKey]}
      <Icon aria-hidden className={active ? "size-3.5 text-foreground" : "size-3.5 opacity-60"} />
    </button>
  );
}

function ProjectsPage() {
  const can = useCan();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const debouncedSearch = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_IN_MS);
  const projects = useQuery({
    queryKey: ["projects", debouncedSearch],
    queryFn: () => listProjectsFn({ data: { search: debouncedSearch } }),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
  const navigate = useNavigate();
  const [sort, setSort] = useState<SortState>({ key: "name", direction: "ascending" });
  const toggleSort = (key: SortKey) =>
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "ascending" ? "descending" : "ascending",
    }));
  const [now] = useState(() => new Date());
  const columns = useColumns(now);
  const rows = useMemo(
    () =>
      sortProjects(
        (projects.data ?? NO_PROJECTS).filter((project) => matchesFilter(project, filter)),
        sort,
      ),
    [projects.data, filter, sort],
  );
  const openProject = (projectId: string) =>
    void navigate({ to: "/projects/$projectId", params: { projectId } });
  const table = useTable({ features, columns, data: rows });

  return (
    <>
      <PageHeader
        title="Projetos"
        description="Aplicações implantadas a partir de repositórios GitHub."
        actions={
          can("project:write") ? (
            <Button asChild>
              <Link to="/projects/new">
                <PlusIcon aria-hidden />
                Novo projeto
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="relative flex-1">
          <Label htmlFor="project-search" className="sr-only">
            Buscar projetos
          </Label>
          <SearchIcon
            aria-hidden
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="project-search"
            placeholder="Buscar por nome, identificador ou repositório"
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="sm:w-56">
          <Label htmlFor="project-filter" className="sr-only">
            Filtrar por situação
          </Label>
          <Select
            value={filter}
            onValueChange={(value) => setFilter(isStatusFilter(value) ? value : "all")}
          >
            <SelectTrigger id="project-filter" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_FILTERS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <ProjectsTableBody
        isPending={projects.isPending}
        error={projects.isError ? projects.error : null}
        onRetry={() => void projects.refetch()}
        hasProjects={(projects.data ?? NO_PROJECTS).length > 0}
        filtered={rows.length === 0}
        canCreate={can("project:write")}
      >
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers.map((header) => {
                    const sortKey = isSortKey(header.column.id) ? header.column.id : null;
                    let ariaSort: "ascending" | "descending" | "none" | undefined;
                    if (sortKey != null) {
                      ariaSort = sort.key === sortKey ? sort.direction : "none";
                    }
                    return (
                      <TableHead key={header.id} aria-sort={ariaSort}>
                        {sortKey == null ? (
                          <table.FlexRender header={header} />
                        ) : (
                          <SortButton sortKey={sortKey} sort={sort} onSort={toggleSort} />
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  tabIndex={0}
                  aria-label={`Abrir ${row.original.name}`}
                  className="cursor-pointer focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
                  onClick={() => openProject(row.original.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openProject(row.original.id);
                    }
                  }}
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
      </ProjectsTableBody>
    </>
  );
}

function ProjectsTableBody({
  isPending,
  error,
  onRetry,
  hasProjects,
  filtered,
  canCreate,
  children,
}: {
  readonly isPending: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly hasProjects: boolean;
  readonly filtered: boolean;
  readonly canCreate: boolean;
  readonly children: React.ReactNode;
}) {
  if (error != null) {
    return <ErrorState error={error} onRetry={onRetry} />;
  }
  if (isPending) {
    return <ListSkeleton rows={5} />;
  }
  if (hasProjects === false) {
    return (
      <EmptyState
        icon={BoxesIcon}
        title="Nenhum projeto encontrado"
        description="Cadastre uma aplicação apontando para um repositório GitHub com Dockerfile."
        action={
          canCreate ? (
            <Button asChild>
              <Link to="/projects/new">
                <PlusIcon aria-hidden />
                Novo projeto
              </Link>
            </Button>
          ) : null
        }
      />
    );
  }
  if (filtered) {
    return <EmptyState icon={BoxesIcon} title="Nenhum projeto nesta situação" />;
  }
  return children;
}
