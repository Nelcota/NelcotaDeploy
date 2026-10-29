import { useForm } from "@tanstack/react-form";

import type { Task } from "@/tasks";
import { useAction } from "@/web/components/layout/use-action";
import { createTaskFn, updateTaskFn } from "@/web/functions/tasks.functions";

import { type TaskFormValues, toTaskFormValues, validateTaskForm } from "./task-form-values";

/**
 * Form state that creates a task, or updates `task` when given, validated on submit.
 *
 * @param options - Project, the task being edited (null for a new one) and what to do after
 *   saving.
 * @returns The form.
 */
export function useTaskForm({
  projectId,
  task,
  onSaved,
}: {
  readonly projectId: string;
  readonly task: Task | null;
  readonly onSaved: () => void;
}) {
  const save = useAction({
    action: async (input: TaskFormValues) => {
      if (task == null) {
        await createTaskFn({ data: { projectId, task: input } });
        return;
      }
      await updateTaskFn({ data: { projectId, taskId: task.id, task: input } });
    },
    successMessage: task == null ? "Task criada" : "Task atualizada",
    invalidate: [["tasks", projectId]],
    onSuccess: onSaved,
  });
  return useForm({
    defaultValues: toTaskFormValues(task),
    validators: { onSubmit: ({ value }) => validateTaskForm(value) },
    onSubmit: async ({ value }) => {
      await save.mutateAsync(value);
    },
  });
}

/** Form state returned by {@link useTaskForm}. */
export type TaskFormApi = ReturnType<typeof useTaskForm>;
