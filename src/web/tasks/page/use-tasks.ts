import type { Task } from "@/tasks";
import { useAction } from "@/web/components/layout/use-action";
import { deleteTaskFn, runTaskFn, updateTaskFn } from "@/web/functions/tasks.functions";

import { toTaskFormValues } from "../task-form-values";

export { useTasksQuery } from "../task-query";

/** Enables or disables, runs and deletes the tasks of one project. */
export function useTaskActions(projectId: string) {
  const toggle = useAction({
    action: (input: { readonly task: Task; readonly enabled: boolean }) =>
      updateTaskFn({
        data: {
          projectId,
          taskId: input.task.id,
          task: toTaskFormValues(input.task, input.enabled),
          expectedUpdatedAt: input.task.updatedAt,
        },
      }),
    successMessage: "Tarefa atualizada",
    invalidate: [["tasks", projectId]],
  });
  const run = useAction({
    action: (task: Task) =>
      runTaskFn({
        data: {
          projectId,
          taskId: task.id,
          expected: { command: task.command, timeoutInSeconds: task.timeoutInSeconds },
        },
      }),
    successMessage: "Execução colocada na fila",
    invalidate: [
      ["tasks", projectId],
      ["task-executions", projectId],
    ],
  });
  const remove = useAction({
    action: (taskId: string) => deleteTaskFn({ data: { projectId, taskId } }),
    successMessage: "Tarefa excluída",
    invalidate: [["tasks", projectId]],
  });
  return { toggle, run, remove };
}

export type TaskActions = ReturnType<typeof useTaskActions>;
