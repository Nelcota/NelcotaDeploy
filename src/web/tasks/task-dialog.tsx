import { useForm } from "@tanstack/react-form";
import { LoaderCircleIcon } from "lucide-react";

import type { Task } from "@/tasks";
import { describeCronSchedule } from "@/web/components/cron-description";
import { FormField } from "@/web/components/form-field";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { Switch } from "@/web/components/ui/switch";
import { useAction } from "@/web/components/use-action";
import { createTaskFn, updateTaskFn } from "@/web/functions/tasks.functions";

import { type TaskFormValues, toTaskFormValues, validateTaskForm } from "./task-form-values";
const SCHEDULE_PRESETS = [
  { label: "Sob demanda", cron: "" },
  { label: "A cada hora", cron: "0 * * * *" },
  { label: "Todo dia às 03:00", cron: "0 3 * * *" },
  { label: "Toda segunda às 08:00", cron: "0 8 * * 1" },
] as const;

function scheduleHint(schedule: string, timeZone: string): string {
  if (schedule.trim() === "") {
    return `Sem agendamento: a task só roda quando executada. Cron de 5 campos no fuso ${timeZone}.`;
  }
  const description = describeCronSchedule(schedule);
  return description == null
    ? `Cron de 5 campos no fuso ${timeZone}.`
    : `${description} (fuso ${timeZone}).`;
}

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
    onSuccess: () => onOpenChange(false),
  });
  const form = useForm({
    defaultValues: toTaskFormValues(task),
    validators: { onSubmit: ({ value }) => validateTaskForm(value) },
    onSubmit: async ({ value }) => {
      await save.mutateAsync(value);
    },
  });

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
          <form.Field name="name">
            {(field) => (
              <FormField id="task-name" label="Nome" errors={field.state.meta.errors}>
                {(props) => (
                  <Input
                    {...props}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                )}
              </FormField>
            )}
          </form.Field>
          <form.Field name="commandLine">
            {(field) => (
              <FormField
                id="task-command"
                label="Comando"
                hint="Exemplo: bun run db:migrate"
                errors={field.state.meta.errors}
              >
                {(props) => (
                  <Input
                    {...props}
                    className="font-mono"
                    autoComplete="off"
                    spellCheck={false}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                )}
              </FormField>
            )}
          </form.Field>
          <form.Field name="schedule">
            {(field) => (
              <div className="space-y-2">
                <FormField
                  id="task-schedule"
                  label="Agendamento"
                  hint={scheduleHint(field.state.value, timeZone)}
                  errors={field.state.meta.errors}
                >
                  {(props) => (
                    <Input
                      {...props}
                      className="font-mono"
                      placeholder="0 3 * * *"
                      autoComplete="off"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                  )}
                </FormField>
                <div
                  role="group"
                  aria-label="Atalhos de agendamento"
                  className="flex flex-wrap gap-1.5"
                >
                  {SCHEDULE_PRESETS.map((preset) => (
                    <Button
                      key={preset.label}
                      type="button"
                      variant={field.state.value.trim() === preset.cron ? "secondary" : "outline"}
                      size="xs"
                      onClick={() => field.handleChange(preset.cron)}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </form.Field>
          <form.Field name="timeoutInSeconds">
            {(field) => (
              <FormField
                id="task-timeout"
                label="Tempo limite (segundos)"
                errors={field.state.meta.errors}
              >
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) =>
                      // An emptied field gives NaN; 0 lets the schema answer with its own message.
                      field.handleChange(
                        Number.isFinite(event.target.valueAsNumber)
                          ? event.target.valueAsNumber
                          : 0,
                      )
                    }
                  />
                )}
              </FormField>
            )}
          </form.Field>
          <form.Field name="enabled">
            {(field) => (
              <div className="flex items-center gap-2">
                <Switch
                  id="task-enabled"
                  checked={field.state.value}
                  onCheckedChange={field.handleChange}
                />
                <Label htmlFor="task-enabled">Ativa</Label>
              </div>
            )}
          </form.Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
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
        </form>
      </DialogContent>
    </Dialog>
  );
}
