import { useQuery } from "@tanstack/react-query";

import { listTasksFn } from "@/web/functions/tasks.functions";
const TASKS_REFRESH_INTERVAL_IN_MS = 10_000;

/** The tasks of one project and the time zone their schedules use, refreshed periodically. */
export function useTasksQuery(projectId: string) {
  return useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => listTasksFn({ data: { projectId } }),
    refetchInterval: TASKS_REFRESH_INTERVAL_IN_MS,
  });
}
