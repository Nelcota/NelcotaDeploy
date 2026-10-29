import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { matchesProjectFilter } from "@/web/components/projects/project-filter";
import { listProjectsFn } from "@/web/functions/projects.functions";

import {
  type ProjectRow,
  SORT_OPTIONS,
  type SortOption,
  sortProjects,
  type StatusFilter,
} from "./project-list";

const SEARCH_DEBOUNCE_IN_MS = 300;
const REFRESH_INTERVAL_IN_MS = 10_000;
const NO_PROJECTS: ProjectRow[] = [];

function useDebouncedValue(value: string, delayInMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayInMs);
    return () => clearTimeout(timer);
  }, [value, delayInMs]);
  return debounced;
}

/**
 * Searches projects on the server (debounced), then filters and sorts them in the browser.
 *
 * @param search - Text typed in the search box.
 * @param filter - Status filter from the URL.
 * @param sortOption - Chosen order.
 */
export function useProjectList({
  search,
  filter,
  sortOption,
}: {
  readonly search: string;
  readonly filter: StatusFilter;
  readonly sortOption: SortOption;
}) {
  const debouncedSearch = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_IN_MS);
  const projects = useQuery({
    queryKey: ["projects", debouncedSearch],
    queryFn: () => listProjectsFn({ data: { search: debouncedSearch } }),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
  const rows = useMemo(
    () =>
      sortProjects(
        (projects.data ?? NO_PROJECTS).filter((project) => matchesProjectFilter(project, filter)),
        SORT_OPTIONS[sortOption],
      ),
    [projects.data, filter, sortOption],
  );
  return {
    projects,
    rows,
    hasProjects: (projects.data ?? NO_PROJECTS).length > 0,
    filtering: filter !== "all" || debouncedSearch !== "",
  };
}
