import { useQuery } from "@tanstack/react-query";
import { FilterXIcon, RocketIcon } from "lucide-react";

import { SegmentedControl } from "@/web/components/layout/overview";
import { EmptyState } from "@/web/components/layout/states";
import { Button } from "@/web/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { listProjectsFn } from "@/web/functions/projects.functions";

import { STATUS_FILTERS, type StatusFilter } from "../deployment-history";

export const ALL_PROJECTS = "all";

/** Title of the history with its project and status filters. */
export function HistoryHeader({
  projectFilter,
  onProjectFilterChange,
  statusFilter,
  onStatusFilterChange,
}: {
  readonly projectFilter: string;
  readonly onProjectFilterChange: (projectId: string) => void;
  readonly statusFilter: StatusFilter;
  readonly onStatusFilterChange: (filter: StatusFilter) => void;
}) {
  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
      <ProjectFilter value={projectFilter} onChange={onProjectFilterChange} />
      <SegmentedControl
        label="Filtrar deploys por status"
        options={STATUS_FILTERS}
        value={statusFilter}
        onChange={onStatusFilterChange}
        wrap
      />
    </div>
  );
}

function ProjectFilter({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (projectId: string) => void;
}) {
  const projects = useQuery({
    queryKey: ["projects", "filter"],
    queryFn: () => listProjectsFn({ data: {} }),
  });
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="Filtrar deploys por projeto" className="w-full sm:w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_PROJECTS}>Todos os projetos</SelectItem>
        {(projects.data ?? []).map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {project.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Empty history: a hint to clear the filters, or a note that nothing was deployed yet. */
export function EmptyHistory({
  filtered,
  onClearFilters,
}: {
  readonly filtered: boolean;
  readonly onClearFilters: () => void;
}) {
  if (filtered === false) {
    return (
      <EmptyState
        icon={RocketIcon}
        title="Nenhum deploy ainda"
        description="Eles aparecem aqui assim que forem solicitados."
      />
    );
  }
  return (
    <EmptyState
      icon={FilterXIcon}
      title="Nenhum deploy com estes filtros"
      action={
        <Button variant="outline" size="sm" onClick={onClearFilters}>
          Limpar filtros
        </Button>
      }
    />
  );
}
