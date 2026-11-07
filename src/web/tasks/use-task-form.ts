import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import type { Task } from "@/tasks";
import { toUserMessage } from "@/web/components/layout/error-message";
import { useAction } from "@/web/components/layout/use-action";
import { createTaskFn, updateTaskFn } from "@/web/functions/tasks.functions";

import { requiresScheduleReview } from "./automation/task-defaults";
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
  const [reviewed, setReviewed] = useState<TaskFormValues | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const save = useAction({
    action: async (input: TaskFormValues) => {
      if (task == null) {
        await createTaskFn({ data: { projectId, task: input } });
        return;
      }
      await updateTaskFn({
        data: { projectId, taskId: task.id, task: input, expectedUpdatedAt: task.updatedAt },
      });
    },
    successMessage: task == null ? "Tarefa criada" : "Tarefa atualizada",
    invalidate: [["tasks", projectId]],
    onSuccess: onSaved,
  });
  const form = useForm({
    defaultValues: toTaskFormValues(task),
    validators: { onSubmit: ({ value }) => validateTaskForm(value) },
    onSubmit: async ({ value }) => {
      setReviewError(null);
      if (requiresScheduleReview(task, value)) {
        setReviewed({ ...value });
        setReviewError(null);
        return;
      }
      try {
        await save.mutateAsync(value);
      } catch (error) {
        setReviewError(toUserMessage(error, "Não foi possível salvar a tarefa. Tente novamente."));
      }
    },
  });
  const confirm = async () => {
    if (reviewed == null || save.isPending) {
      return;
    }
    try {
      await save.mutateAsync(reviewed);
    } catch (error) {
      setReviewError(
        toUserMessage(error, "Não foi possível salvar o agendamento. Volte e confira os dados."),
      );
    }
  };
  return {
    form,
    reviewed,
    reviewError,
    confirm,
    pending: save.isPending,
    cancelReview: () => setReviewed(null),
  };
}

/** Form state returned by {@link useTaskForm}. */
export type TaskFormApi = ReturnType<typeof useTaskForm>["form"];
