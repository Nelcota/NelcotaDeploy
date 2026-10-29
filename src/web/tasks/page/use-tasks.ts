import { useQuery } from "@tanstack/react-query";

import type { Task } from "@/tasks";
import { useAction } from "@/web/components/layout/use-action";
import {
  deleteTaskFn,
  listTasksFn,
  runTaskFn,
  updateTaskFn,
} from "@/web/functions/tasks.functions";

import { toTaskFormValues } from "../task-form-values";

const TASKS_REFRESH_INTERVAL_IN_MS = 10_000;

/** The tasks of one project and the time zone their schedules use, refreshed periodically. */
export function useTasksQuery(projectId: string) {
  return useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => listTasksFn({ data: { projectId } }),
    refetchInterval: TASKS_REFRESH_INTERVAL_IN_MS,
  });
}

/** Enables or disables, runs and deletes the tasks of one project. */
export function useTaskActions(projectId: string) {
  const toggle = useAction({
    action: (input: { readonly task: Task; readonly enabled: boolean }) =>
      updateTaskFn({
        data: {
          projectId,
          taskId: input.task.id,
          task: toTaskFormValues(input.task, input.enabled),
        },
      }),
    successMessage: "Task atualizada",
    invalidate: [["tasks", projectId]],
  });
  const run = useAction({
    action: (taskId: string) => runTaskFn({ data: { projectId, taskId } }),
    successMessage: "Execução colocada na fila",
    invalidate: [
      ["tasks", projectId],
      ["task-executions", projectId],
    ],
  });
  const remove = useAction({
    action: (taskId: string) => deleteTaskFn({ data: { projectId, taskId } }),
    successMessage: "Task excluída",
    invalidate: [["tasks", projectId]],
  });
  return { toggle, run, remove };
}

export type TaskActions = ReturnType<typeof useTaskActions>;
