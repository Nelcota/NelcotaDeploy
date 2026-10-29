import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  type ApplicationFilter,
  matchesApplicationFilter,
} from "@/web/components/projects/project-accent";
import { listProjectsFn } from "@/web/functions/projects.functions";

import { REFRESH_INTERVAL_IN_MS } from "./dashboard";

/** Every project, refreshed periodically, and the ones the chosen state filter keeps. */
export function useApplications() {
  const [filter, setFilter] = useState<ApplicationFilter>("all");
  const projects = useQuery({
    queryKey: ["projects", ""],
    queryFn: () => listProjectsFn({ data: { search: "" } }),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
  const all = projects.data ?? [];
  const visible = all.filter((project) =>
    matchesApplicationFilter(filter, project.containerState, project.containerHealth),
  );
  return { projects, all, visible, filter, setFilter };
}
