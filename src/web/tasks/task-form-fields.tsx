import { FormField } from "@/web/components/forms/form-field";
import { describeCronSchedule } from "@/web/components/projects/cron-description";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { Switch } from "@/web/components/ui/switch";

import type { TaskFormApi } from "./use-task-form";

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

/** Task name and the command it runs. */
export function TaskCommandFields({ form }: { readonly form: TaskFormApi }) {
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
    </>
  );
}

function SchedulePresets({
  schedule,
  onPick,
}: {
  readonly schedule: string;
  readonly onPick: (cron: string) => void;
}) {
  return (
    <div role="group" aria-label="Atalhos de agendamento" className="flex flex-wrap gap-1.5">
      {SCHEDULE_PRESETS.map((preset) => (
        <Button
          key={preset.label}
          type="button"
          variant={schedule.trim() === preset.cron ? "secondary" : "outline"}
          size="xs"
          onClick={() => onPick(preset.cron)}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  );
}

/** Cron schedule with a readable description and common presets. */
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
          <SchedulePresets schedule={field.state.value} onPick={field.handleChange} />
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
