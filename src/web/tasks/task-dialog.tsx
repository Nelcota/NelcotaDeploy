import { ClockIcon, LoaderCircleIcon } from "lucide-react";

import type { Task } from "@/tasks";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";

import { RepositoryTaskScripts } from "./automation/repository-task-scripts";
import { requiresScheduleReview } from "./automation/task-defaults";
import { TaskScheduleReview } from "./automation/task-schedule-review";
import { useTaskAutomation } from "./automation/use-task-automation";
import { ScheduleField, TaskCommandFields, TaskLimitFields } from "./task-form-fields";
import { type TaskFormApi, useTaskForm } from "./use-task-form";

function TaskDialogFooter({
  form,
  task,
  onCancel,
}: {
  readonly form: TaskFormApi;
  readonly task: Task | null;
  readonly onCancel: () => void;
}) {
  return (
    <form.Subscribe
      selector={(state) =>
        [state.isSubmitting, requiresScheduleReview(task, state.values)] as const
      }
    >
      {([isSubmitting, needsReview]) => (
        <DialogFooter>
          <Button type="button" variant="outline" disabled={isSubmitting} onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
            {needsReview ? "Revisar agendamento da tarefa" : "Salvar tarefa"}
          </Button>
        </DialogFooter>
      )}
    </form.Subscribe>
  );
}

/** Dialog that creates a task, or edits `task` when given. */
export function TaskDialog({
  projectId,
  task,
  timeZone,
  open,
  onOpenChange,
}: {
  readonly projectId: string;
  readonly task: Task | null;
  readonly timeZone: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const editing = useTaskForm({ projectId, task, onSaved: () => onOpenChange(false) });
  const { form } = editing;
  const automation = useTaskAutomation(form, { projectId, enabled: open && task == null });
  const draftTitle = task == null ? "Nova tarefa" : `Editar ${task.name}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (editing.pending === false) {
          onOpenChange(next);
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader icon={<ClockIcon />}>
          <DialogTitle>
            {editing.reviewed == null ? draftTitle : "Confirmar agendamento da tarefa"}
          </DialogTitle>
          <DialogDescription>
            A tarefa usa o contêiner atual da aplicação. Salvar sem agendamento não executa o
            comando.
          </DialogDescription>
        </DialogHeader>
        {editing.reviewed != null ? (
          <TaskScheduleReview
            values={editing.reviewed}
            timeZone={timeZone}
            pending={editing.pending}
            error={editing.reviewError}
            onBack={editing.cancelReview}
            onConfirm={() => void editing.confirm()}
          />
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <fieldset disabled={editing.pending} className="space-y-4">
              {task == null ? <RepositoryTaskScripts automation={automation} /> : null}
              <TaskCommandFields form={form} onEdited={automation.markEdited} />
              <ScheduleField form={form} timeZone={timeZone} />
              <TaskLimitFields form={form} />
            </fieldset>
            {editing.reviewError == null ? null : (
              <p role="alert" className="text-sm text-destructive">
                {editing.reviewError}
              </p>
            )}
            <TaskDialogFooter form={form} task={task} onCancel={() => onOpenChange(false)} />
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
