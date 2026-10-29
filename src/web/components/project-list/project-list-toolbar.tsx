import { SearchIcon } from "lucide-react";

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
  isSortOption,
  isStatusFilter,
  SORT_OPTIONS,
  type SortOption,
  STATUS_FILTERS,
  type StatusFilter,
} from "./project-list";

/** Search box, status filter and sort order of the project list. */
export function ProjectListToolbar({
  search,
  onSearchChange,
  filter,
  onFilterChange,
  sortOption,
  onSortOptionChange,
}: {
  readonly search: string;
  readonly onSearchChange: (search: string) => void;
  readonly filter: StatusFilter;
  readonly onFilterChange: (filter: StatusFilter) => void;
  readonly sortOption: SortOption;
  readonly onSortOptionChange: (option: SortOption) => void;
}) {
  return (
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
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>
      <StatusFilterSelect value={filter} onChange={onFilterChange} />
      <SortSelect value={sortOption} onChange={onSortOptionChange} />
    </div>
  );
}

function StatusFilterSelect({
  value,
  onChange,
}: {
  readonly value: StatusFilter;
  readonly onChange: (filter: StatusFilter) => void;
}) {
  return (
    <>
      <Label htmlFor="project-filter" className="sr-only">
        Filtrar por situação
      </Label>
      <Select value={value} onValueChange={(next) => onChange(isStatusFilter(next) ? next : "all")}>
        <SelectTrigger id="project-filter" className="w-full sm:w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(STATUS_FILTERS).map(([filter, label]) => (
            <SelectItem key={filter} value={filter}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function SortSelect({
  value,
  onChange,
}: {
  readonly value: SortOption;
  readonly onChange: (option: SortOption) => void;
}) {
  return (
    <>
      <Label htmlFor="project-sort" className="sr-only">
        Ordenar por
      </Label>
      <Select
        value={value}
        onValueChange={(next) => onChange(isSortOption(next) ? next : "name-ascending")}
      >
        <SelectTrigger id="project-sort" className="w-full sm:w-64">
          <span className="text-faint">Ordenar por</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(SORT_OPTIONS).map(([option, { label }]) => (
            <SelectItem key={option} value={option}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
