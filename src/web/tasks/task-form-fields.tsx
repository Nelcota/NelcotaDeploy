import { FormField } from "@/web/components/forms/form-field";
import { describeCronSchedule } from "@/web/components/projects/cron-description";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { Switch } from "@/web/components/ui/switch";

import { TaskScheduleEditor } from "./automation/task-schedule-editor";
import type { TaskFormApi } from "./use-task-form";

function scheduleHint(schedule: string, timeZone: string): string {
  if (schedule.trim() === "") {
    return "Sem agendamento: a tarefa só roda quando você pedir a execução.";
  }
  const description = describeCronSchedule(schedule);
  return description == null
    ? `Cron de 5 campos no fuso ${timeZone}.`
    : `${description} (fuso ${timeZone}).`;
}

/** Task name and the command it runs. */
export function TaskCommandFields({
  form,
  onEdited,
}: {
  readonly form: TaskFormApi;
  readonly onEdited: (field: "name" | "commandLine") => void;
}) {
  return (
    <>
      <form.Field name="name">
        {(field) => (
          <FormField id="task-name" label="Nome" errors={field.state.meta.errors}>
            {(props) => (
              <Input
                {...props}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  onEdited("name");
                  field.handleChange(event.target.value);
                }}
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
                onChange={(event) => {
                  onEdited("commandLine");
                  field.handleChange(event.target.value);
                }}
              />
            )}
          </FormField>
        )}
      </form.Field>
    </>
  );
}

/** Guided schedule with automatic cron generation and a readable time-zone description. */
export function ScheduleField({
  form,
  timeZone,
}: {
  readonly form: TaskFormApi;
  readonly timeZone: string;
}) {
  return (
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
              <TaskScheduleEditor
                {...props}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={field.handleChange}
              />
            )}
          </FormField>
        </div>
      )}
    </form.Field>
  );
}

/** Time limit in seconds and the enabled switch. */
export function TaskLimitFields({ form }: { readonly form: TaskFormApi }) {
  return (
    <>
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
                    Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0,
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
    </>
  );
}
