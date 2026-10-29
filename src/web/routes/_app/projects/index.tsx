import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BoxesIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { List } from "@/web/components/layout/layout";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { matchesProjectFilter } from "@/web/components/projects/project-filter";
import { ProjectListRow } from "@/web/components/projects/project-list-row";
import { PageHeader } from "@/web/components/shell/page-header";
import { useCan } from "@/web/components/shell/use-permissions";
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
import { listProjectsFn } from "@/web/functions/projects.functions";

const SEARCH_DEBOUNCE_IN_MS = 300;
const REFRESH_INTERVAL_IN_MS = 10_000;

type ProjectRow = Awaited<ReturnType<typeof listProjectsFn>>[number];

const STATUS_FILTERS = {
  all: "Todos",
  online: "Online",
  offline: "Precisam de atenção",
  never: "Sem deploy",
  pending: "Aguardando aprovação",
} as const;

type StatusFilter = keyof typeof STATUS_FILTERS;

const STATUS_FILTER_VALUES = [
  "all",
  "online",
  "offline",
  "never",
  "pending",
] as const satisfies readonly StatusFilter[];

// The status filter lives in the URL so links such as the top bar shortcuts open the list filtered.
export const Route = createFileRoute("/_app/projects/")({
  validateSearch: z.object({ status: z.enum(STATUS_FILTER_VALUES).optional().catch(undefined) }),
  head: () => ({ meta: [{ title: "Projetos · Nelcota Deploy" }] }),
  component: ProjectsPage,
});

function isStatusFilter(value: string): value is StatusFilter {
  return Object.hasOwn(STATUS_FILTERS, value);
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

function ProjectsPage() {
  const can = useCan();
  const [search, setSearch] = useState("");
  const navigate = useNavigate({ from: Route.fullPath });
  const filter: StatusFilter = Route.useSearch().status ?? "all";
  const setFilter = (next: StatusFilter) => {
    void navigate({ search: { status: next === "all" ? undefined : next }, replace: true });
  };
  const [sortOption, setSortOption] = useState<SortOption>("name-ascending");
  const debouncedSearch = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_IN_MS);
  const projects = useQuery({
    queryKey: ["projects", debouncedSearch],
    queryFn: () => listProjectsFn({ data: { search: debouncedSearch } }),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
  const now = new Date();
  const rows = useMemo(
    () =>
      sortProjects(
        (projects.data ?? NO_PROJECTS).filter((project) => matchesProjectFilter(project, filter)),
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
        {projects.isPending ? <ListSkeleton rows={5} /> : null}
        {projects.data != null && rows.length === 0 && (hasProjects || filtering) ? (
          <EmptyState
            icon={SearchIcon}
            title="Nenhum projeto encontrado"
            description="Nenhum projeto corresponde à busca ou ao filtro."
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
              >
                Limpar filtros
              </Button>
            }
          />
        ) : null}
        {projects.data != null &&
        rows.length === 0 &&
        hasProjects === false &&
        filtering === false ? (
          <EmptyState
            icon={BoxesIcon}
            title="Nenhum projeto ainda"
            description="Cadastre uma aplicação apontando para um repositório GitHub com Dockerfile."
            action={
              canCreate ? (
                <Button size="sm" asChild>
                  <Link to="/projects/new">
                    <PlusIcon aria-hidden />
                    Criar projeto
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : null}
        {projects.data != null && rows.length > 0 ? (
          <section aria-label="Lista de projetos">
            <List>
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
