import { LoaderCircleIcon } from "lucide-react";

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

import { ScheduleField, TaskCommandFields, TaskLimitFields } from "./task-form-fields";
import { type TaskFormApi, useTaskForm } from "./use-task-form";

function TaskDialogFooter({
  form,
  onCancel,
}: {
  readonly form: TaskFormApi;
  readonly onCancel: () => void;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancelar
      </Button>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
            Salvar
          </Button>
        )}
      </form.Subscribe>
    </DialogFooter>
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
  const form = useTaskForm({ projectId, task, onSaved: () => onOpenChange(false) });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{task == null ? "Nova task" : `Editar ${task.name}`}</DialogTitle>
          <DialogDescription>
            O comando é dividido em argumentos como num shell, sem expansão de variáveis ou pipes.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <TaskCommandFields form={form} />
          <ScheduleField form={form} timeZone={timeZone} />
          <TaskLimitFields form={form} />
          <TaskDialogFooter form={form} onCancel={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
