import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { DeploymentStatus } from "@/deployments";
import { formatRelativeTime } from "@/shared/format";
import { DEPLOYMENT_STATUS_LABELS } from "@/web/components/labels";
import { List, ListRow } from "@/web/components/layout";
import { PageHeader } from "@/web/components/page-header";
import { containerAccent } from "@/web/components/project-accent";
import { ErrorState } from "@/web/components/states";
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
import { Skeleton } from "@/web/components/ui/skeleton";
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

const SORT_OPTIONS = {
  "name-ascending": { label: "Nome (A–Z)", key: "name", direction: "ascending" },
  "name-descending": { label: "Nome (Z–A)", key: "name", direction: "descending" },
  "latestDeployment-descending": {
    label: "Deploy mais recente",
    key: "latestDeployment",
    direction: "descending",
  },
  "latestDeployment-ascending": {
    label: "Deploy mais antigo",
    key: "latestDeployment",
    direction: "ascending",
  },
} as const satisfies Record<string, SortState & { readonly label: string }>;

type SortOption = keyof typeof SORT_OPTIONS;

function isSortOption(value: string): value is SortOption {
  return Object.hasOwn(SORT_OPTIONS, value);
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

function LatestDeployment({ project, now }: { readonly project: ProjectRow; readonly now: Date }) {
  const latest = project.latestDeployment;
  if (latest == null || isDeploymentStatus(latest.status) === false) {
    return <p className="text-xs text-faint">sem deploy</p>;
  }
  return (
    <div className="space-y-0.5">
      <DeploymentStatusBadge status={latest.status} />
      <p className="text-xs text-faint">{formatRelativeTime(latest.createdAt, now)}</p>
    </div>
  );
}

function ProjectListRow({ project, now }: { readonly project: ProjectRow; readonly now: Date }) {
  const navigate = useNavigate();
  const accent = project.deploymentsApproved
    ? containerAccent(project.containerState, project.containerHealth)
    : "warning";
  return (
    <ListRow accent={accent}>
      <button
        type="button"
        aria-label={`Abrir ${project.name}`}
        onClick={() =>
          void navigate({ to: "/projects/$projectId", params: { projectId: project.id } })
        }
        className="absolute inset-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{project.name}</p>
        <p className="truncate font-mono text-xs text-faint">{project.slug}</p>
      </div>
      <div className="hidden w-56 min-w-0 shrink-0 text-sm md:block">
        <p className="truncate text-muted-foreground">{project.repositoryFullName}</p>
        <p className="truncate font-mono text-xs text-faint">{project.branch}</p>
      </div>
      <div className="hidden w-36 shrink-0 lg:block">
        <LatestDeployment project={project} now={now} />
      </div>
      <p className="hidden w-20 shrink-0 text-xs text-muted-foreground lg:block">
        {project.autoDeploy ? "Automático" : "Manual"}
      </p>
      <div className="flex w-40 shrink-0 justify-end">
        {project.deploymentsApproved ? (
          <ContainerStateBadge state={project.containerState} health={project.containerHealth} />
        ) : (
          <StatusPill tone="warning" label="Aguardando aprovação" />
        )}
      </div>
    </ListRow>
  );
}

function ProjectsPage() {
  const can = useCan();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [sortOption, setSortOption] = useState<SortOption>("name-ascending");
  const debouncedSearch = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_IN_MS);
  const projects = useQuery({
    queryKey: ["projects", debouncedSearch],
    queryFn: () => listProjectsFn({ data: { search: debouncedSearch } }),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
  const [now] = useState(() => new Date());
  const rows = useMemo(
    () =>
      sortProjects(
        (projects.data ?? NO_PROJECTS).filter((project) => matchesFilter(project, filter)),
        SORT_OPTIONS[sortOption],
      ),
    [projects.data, filter, sortOption],
  );
  const canCreate = can("project:write");
  const hasProjects = (projects.data ?? NO_PROJECTS).length > 0;
  const filtering = filter !== "all" || debouncedSearch !== "";

  return (
    <>
      <PageHeader
        title="Projetos"
        description="Aplicações implantadas a partir de repositórios GitHub."
        actions={
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
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Label htmlFor="project-search" className="sr-only">
              Buscar projetos
            </Label>
            <SearchIcon
              aria-hidden
              className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
            />
            <Input
              id="project-search"
              placeholder="Buscar por nome, identificador ou repositório"
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Label htmlFor="project-filter" className="sr-only">
            Filtrar por situação
          </Label>
          <Select
            value={filter}
            onValueChange={(value) => setFilter(isStatusFilter(value) ? value : "all")}
          >
            <SelectTrigger id="project-filter" className="w-full sm:w-48">
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
          <Label htmlFor="project-sort" className="sr-only">
            Ordenar por
          </Label>
          <Select
            value={sortOption}
            onValueChange={(value) => setSortOption(isSortOption(value) ? value : "name-ascending")}
          >
            <SelectTrigger id="project-sort" className="w-full sm:w-64">
              <span className="text-faint">Ordenar por</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SORT_OPTIONS).map(([value, option]) => (
                <SelectItem key={value} value={value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {projects.isError ? (
          <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
        ) : null}
        {projects.isPending ? <Skeleton className="h-80 rounded-xl" /> : null}
        {projects.isSuccess ? (
          <section aria-label="Lista de projetos">
            <List>
              {rows.length === 0 ? (
                <ListRow>
                  <p className="flex-1 text-sm text-muted-foreground">
                    {hasProjects || filtering
                      ? "Nenhum projeto corresponde à busca ou ao filtro."
                      : "Nenhum projeto ainda. Cadastre uma aplicação apontando para um repositório GitHub com Dockerfile."}
                  </p>
                  {canCreate && hasProjects === false && filtering === false ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/projects/new">Criar projeto</Link>
                    </Button>
                  ) : null}
                </ListRow>
              ) : null}
              {rows.map((project) => (
                <ProjectListRow key={project.id} project={project} now={now} />
              ))}
            </List>
          </section>
        ) : null}
      </div>
    </>
  );
}
