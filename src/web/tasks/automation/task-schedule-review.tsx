import { describeCronSchedule } from "@/web/components/projects/cron-description";
import { Button } from "@/web/components/ui/button";

import type { TaskFormValues } from "../task-form-values";

export function TaskScheduleReview({
  values,
  timeZone,
  pending,
  error,
  onBack,
  onConfirm,
}: {
  readonly values: TaskFormValues;
  readonly timeZone: string;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onBack: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm">
        A tarefa <strong>{values.name}</strong> passará a executar automaticamente no contêiner da
        aplicação.
      </p>
      <pre className="overflow-auto rounded-lg bg-secondary p-3 font-mono text-sm whitespace-pre-wrap break-all">
        {values.commandLine}
      </pre>
      <p className="text-sm text-muted-foreground">
        {describeCronSchedule(values.schedule) ?? values.schedule} · fuso {timeZone}. Tempo limite:{" "}
        {values.timeoutInSeconds} segundos.
      </p>
      {error == null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={pending} onClick={onBack}>
          Voltar para editar tarefa
        </Button>
        <Button type="button" disabled={pending} onClick={onConfirm}>
          {pending ? "Salvando…" : "Salvar tarefa e ativar agendamento"}
        </Button>
      </div>
    </div>
  );
}
