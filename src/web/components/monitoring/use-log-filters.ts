import { useMemo, useState } from "react";

import {
  countLogLevels,
  filterLogLines,
  type LogLevelFilter,
} from "@/web/components/monitoring/log-filter";
import type { LogLine } from "@/web/components/monitoring/log-stream";

/** Filter state shared by the log viewer and its toolbar. */
export type LogFilters = ReturnType<typeof useLogFilters>;

/**
 * Text search and level filter over the received lines.
 *
 * @param lines - Lines received so far, oldest first.
 * @returns The filter values with their setters, the warning and error counts of the searched
 *   lines, and the lines left visible.
 */
export function useLogFilters(lines: readonly LogLine[]) {
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>("all");
  const searched = useMemo(() => filterLogLines(lines, { search, level: "all" }), [lines, search]);
  const counts = useMemo(() => countLogLevels(searched), [searched]);
  const visible = useMemo(
    () =>
      levelFilter === "all"
        ? searched
        : filterLogLines(searched, { search: "", level: levelFilter }),
    [searched, levelFilter],
  );
  const clearFilters = () => {
    setSearch("");
    setLevelFilter("all");
  };
  return {
    search,
    setSearch,
    levelFilter,
    setLevelFilter,
    counts,
    visible,
    filtering: search.trim() !== "" || levelFilter !== "all",
    clearFilters,
  };
}
