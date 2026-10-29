import { useState } from "react";

import { PageHeader } from "@/web/components/shell/page-header";
import { useCan } from "@/web/components/shell/use-permissions";

import type { SortOption, StatusFilter } from "./project-list";
import { NewProjectButton, ProjectListContent } from "./project-list-states";
import { ProjectListToolbar } from "./project-list-toolbar";
import { useProjectList } from "./use-project-list";

/** Every project with search, a status filter kept in the URL, and a sort order. */
export function ProjectsPage({
  filter,
  onFilterChange,
}: {
  readonly filter: StatusFilter;
  readonly onFilterChange: (filter: StatusFilter) => void;
}) {
  const can = useCan();
  const canCreate = can("project:write");
  const [search, setSearch] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("name-ascending");
  const list = useProjectList({ search, filter, sortOption });
  const clearFilters = () => {
    setSearch("");
    onFilterChange("all");
  };

  return (
    <>
      <PageHeader
        title="Projetos"
        actions={canCreate ? <NewProjectButton label="Novo projeto" size="default" /> : null}
      />
      <div className="space-y-4">
        <ProjectListToolbar
          search={search}
          onSearchChange={setSearch}
          filter={filter}
          onFilterChange={onFilterChange}
          sortOption={sortOption}
          onSortOptionChange={setSortOption}
        />
        <ProjectListContent list={list} canCreate={canCreate} onClearFilters={clearFilters} />
      </div>
    </>
  );
}
