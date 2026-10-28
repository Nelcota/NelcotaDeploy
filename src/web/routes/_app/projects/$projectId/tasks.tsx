import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  CalendarClockIcon,
  ClockIcon,
  HandIcon,
  InfoIcon,
  HistoryIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { formatCommandLine } from "@/shared/command-line";
import {
  durationBetween,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
} from "@/shared/format";
import { DEFAULT_TASK_TIMEOUT_IN_SECONDS, taskInputSchema } from "@/shared/task.schema";
import type { Task } from "@/tasks";
import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { describeCronSchedule } from "@/web/components/cron-description";
import { FormField } from "@/web/components/form-field";
import { List, ListRow } from "@/web/components/layout";
import { TabHeader } from "@/web/components/project-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/states";
import { TaskStatusBadge } from "@/web/components/status-badge";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/web/components/ui/sheet";
import { Switch } from "@/web/components/ui/switch";
import { useAction } from "@/web/components/use-action";
import { useCan } from "@/web/components/use-permissions";
import {
  createTaskFn,
  deleteTaskFn,
  listTaskExecutionsFn,
  listTasksFn,
  runTaskFn,
  updateTaskFn,
} from "@/web/functions/tasks.functions";

export const Route = createFileRoute("/_app/projects/$projectId/tasks")({
  head: () => ({ meta: [{ title: "Tasks · Nelcota Deploy" }] }),
  component: TasksPage,
});

const TASKS_REFRESH_INTERVAL_IN_MS = 10_000;
const ACTIVE_EXECUTION_REFRESH_INTERVAL_IN_MS = 3000;
const ACTIVE_EXECUTION_STATUSES: ReadonlySet<string> = new Set(["queued", "running"]);

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  schedule: "Agendada",
  mcp: "MCP",
};

type TaskRow = Task & {
  readonly latestExecution: {
    readonly status: string;
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
  } | null;
};

/** Raw form values, as the server function validates them. */
type TaskFormValues = {
  name: string;
  commandLine: string;
  schedule: string;
  enabled: boolean;
  timeoutInSeconds: number;
};

function toTaskFormValues(task: Task | null, enabled?: boolean): TaskFormValues {
  return {
    name: task?.name ?? "",
    commandLine: task == null ? "" : formatCommandLine(task.command),
    schedule: task?.schedule ?? "",
    enabled: enabled ?? task?.enabled ?? true,
    timeoutInSeconds: task?.timeoutInSeconds ?? DEFAULT_TASK_TIMEOUT_IN_SECONDS,
  };
}

/** Validates the whole form with the shared schema and maps issues to fields. */
function validateTaskForm(value: TaskFormValues) {
  const result = taskInputSchema.safeParse(value);
  if (result.success) {
    return undefined;
  }
  const fields: Partial<Record<keyof TaskFormValues, string>> = {};
  const fieldErrors = z.flattenError(result.error).fieldErrors;
  for (const name of Object.keys(value) as (keyof TaskFormValues)[]) {
    const message = (fieldErrors as Partial<Record<string, string[]>>)[name]?.[0];
    if (message != null) {
      fields[name] = message;
    }
  }
  return { fields };
}

function TasksPage() {
  const { projectId } = Route.useParams();
  const can = useCan();
  const canWrite = can("task:write");
  const canRun = can("task:run");
  const tasksQuery = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => listTasksFn({ data: { projectId } }),
    refetchInterval: TASKS_REFRESH_INTERVAL_IN_MS,
  });
  const [dialogTask, setDialogTask] = useState<Task | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [historyTaskId, setHistoryTaskId] = useState<string | null>(null);

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

  const openDialog = (task: Task | null) => {
    setDialogTask(task);
    setDialogOpen(true);
  };

  const timeZone = tasksQuery.data?.timeZone ?? "UTC";
  const tasks: readonly TaskRow[] = tasksQuery.data?.tasks ?? [];
  const now = new Date();
  const historyTask = tasks.find((task) => task.id === historyTaskId) ?? null;

  return (
    <>
      <TabHeader
        icon={ClockIcon}
        title="Tasks"
        count={tasksQuery.data == null ? null : tasks.length}
        description="Comandos que rodam dentro do contêiner da aplicação, sob demanda ou agendados."
        actions={
          canWrite ? (
            <Button onClick={() => openDialog(null)}>
              <PlusIcon aria-hidden />
              Nova task
            </Button>
          ) : null
        }
      />
      {tasksQuery.isError ? (
        <ErrorState error={tasksQuery.error} onRetry={() => void tasksQuery.refetch()} />
      ) : null}
      {tasksQuery.data == null && tasksQuery.isError === false ? <ListSkeleton /> : null}
      {tasksQuery.data != null && tasks.length === 0 ? (
        <EmptyState
          icon={ListChecksIcon}
          title="Nenhuma task ainda"
          description="Use tasks para migrações, limpezas de cache ou rotinas agendadas."
          action={
            canWrite ? (
              <Button size="sm" onClick={() => openDialog(null)}>
                <PlusIcon aria-hidden />
                Nova task
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {tasks.length > 0 ? (
        <List>
          {tasks.map((task) => (
            <TaskListRow
              key={task.id}
              task={task}
              now={now}
              canRun={canRun}
              canWrite={canWrite}
              toggling={toggle.isPending && toggle.variables.task.id === task.id}
              onToggle={(enabled) => toggle.mutate({ task, enabled })}
              onOpenHistory={() => setHistoryTaskId(task.id)}
              running={run.isPending && run.variables === task.id}
              onRun={() => run.mutate(task.id)}
              onEdit={() => openDialog(task)}
              onDelete={() => remove.mutate(task.id)}
            />
          ))}
        </List>
      ) : null}
      <p className="flex items-start gap-2 text-xs leading-relaxed text-faint">
        <InfoIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Cada comando roda com docker exec no contêiner atual, como lista de argumentos: não passa
        por um shell e nunca executa no servidor host. Agendamentos usam o fuso {timeZone}.
      </p>
      <Sheet
        open={historyTask != null}
        onOpenChange={(open) => {
          if (open === false) {
            setHistoryTaskId(null);
          }
        }}
      >
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-xl">
          {historyTask == null ? null : (
            <ExecutionHistory
              projectId={projectId}
              task={historyTask}
              canRun={canRun}
              running={run.isPending}
              onRun={() => run.mutate(historyTask.id)}
            />
          )}
        </SheetContent>
      </Sheet>
      <TaskDialog
        key={dialogTask?.id ?? "new"}
        projectId={projectId}
        task={dialogTask}
        timeZone={timeZone}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}

function executionAccent(status: string | null): "success" | "danger" | "progress" | "neutral" {
  if (status === "succeeded") {
    return "success";
  }
  if (status === "failed") {
    return "danger";
  }
  return status == null ? "neutral" : "progress";
}

const TASK_PILL =
  "shrink-0 rounded-md bg-well px-1.5 py-0.5 text-xs text-muted-foreground ring-1 ring-border/60";

function TaskListRow({
  task,
  now,
  canRun,
  canWrite,
  toggling,
  running,
  onToggle,
  onOpenHistory,
  onRun,
  onEdit,
  onDelete,
}: {
  readonly task: TaskRow;
  readonly now: Date;
  readonly canRun: boolean;
  readonly canWrite: boolean;
  readonly toggling: boolean;
  /** This task's run request is on its way, so another click would queue it twice. */
  readonly running: boolean;
  readonly onToggle: (enabled: boolean) => void;
  readonly onOpenHistory: () => void;
  readonly onRun: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  const command = formatCommandLine(task.command);
  const ScheduleIcon = task.schedule == null ? HandIcon : CalendarClockIcon;
  return (
    <ListRow
      accent={task.enabled ? executionAccent(task.latestExecution?.status ?? null) : "neutral"}
      className="flex-wrap lg:flex-nowrap"
    >
      <span
        aria-hidden
        className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-well text-muted-foreground ring-1 ring-border/70 sm:flex"
      >
        <ScheduleIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 basis-56 space-y-1">
        <p className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="min-w-0 truncate rounded-sm text-left text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            title="Abrir histórico de execuções"
            onClick={onOpenHistory}
          >
            {task.name}
            <span className="sr-only">: abrir histórico de execuções</span>
          </button>
          {task.enabled ? null : <span className={TASK_PILL}>Pausada</span>}
        </p>
        <code className="block truncate font-mono text-xs text-muted-foreground" title={command}>
          {command}
        </code>
      </div>
      <div className="grid w-full grid-cols-2 gap-4 lg:flex lg:w-auto">
        <ScheduleCell task={task} now={now} />
        <LastExecutionCell execution={task.latestExecution} now={now} />
      </div>
      <div className="flex w-full shrink-0 items-center justify-end gap-1 lg:w-auto">
        <div className="mr-auto flex items-center gap-2 lg:mr-2">
          <Switch
            id={`task-enabled-${task.id}`}
            aria-label={`Task ${task.name} ativa`}
            checked={task.enabled}
            disabled={canWrite === false || toggling}
            onCheckedChange={onToggle}
          />
          <span aria-hidden className="w-14 text-xs text-muted-foreground">
            {task.enabled ? "Ativa" : "Pausada"}
          </span>
        </div>
        {canRun ? (
          <Button
            variant="outline"
            size="sm"
            disabled={running}
            aria-label={`Executar ${task.name}`}
            onClick={onRun}
          >
            {running ? (
              <LoaderCircleIcon aria-hidden className="animate-spin" />
            ) : (
              <PlayIcon aria-hidden />
            )}
            Executar
          </Button>
        ) : null}
        {canWrite ? <TaskActions task={task} onEdit={onEdit} onDelete={onDelete} /> : null}
      </div>
    </ListRow>
  );
}

function ScheduleCell({ task, now }: { readonly task: TaskRow; readonly now: Date }) {
  if (task.schedule == null) {
    return (
      <div className="min-w-0 text-xs lg:w-44 lg:shrink-0">
        <p className="text-muted-foreground">Sob demanda</p>
        <p className="text-faint">sem agendamento</p>
      </div>
    );
  }
  const description = describeCronSchedule(task.schedule);
  return (
    <div className="min-w-0 space-y-0.5 text-xs lg:w-44 lg:shrink-0">
      <p className="truncate text-muted-foreground" title={task.schedule}>
        {description ?? <span className="font-mono">{task.schedule}</span>}
      </p>
      {task.enabled && task.nextRunAt != null ? (
        <p className="truncate text-muted-foreground" title={formatDateTime(task.nextRunAt)}>
          próxima {formatRelativeTime(task.nextRunAt, now)}
        </p>
      ) : (
        <p className="truncate text-muted-foreground">{task.enabled ? "" : "pausada"}</p>
      )}
    </div>
  );
}

function LastExecutionCell({
  execution,
  now,
}: {
  readonly execution: TaskRow["latestExecution"];
  readonly now: Date;
}) {
  if (execution == null) {
    return (
      <p className="min-w-0 text-xs text-muted-foreground lg:w-36 lg:shrink-0">Nunca executada</p>
    );
  }
  return (
    <div className="min-w-0 space-y-0.5 lg:w-36 lg:shrink-0">
      <TaskStatusBadge status={execution.status} />
      <p className="text-xs text-faint tabular-nums">
        {execution.startedAt == null
          ? "na fila"
          : `${formatRelativeTime(execution.startedAt, now)} · ${formatDuration(
              durationBetween(execution.startedAt, execution.finishedAt),
            )}`}
      </p>
    </div>
  );
}

function TaskActions({
  task,
  onEdit,
  onDelete,
}: {
  readonly task: Task;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <>
      <Button variant="ghost" size="icon-sm" aria-label={`Editar ${task.name}`} onClick={onEdit}>
        <PencilIcon aria-hidden />
      </Button>
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${task.name}`}>
            <Trash2Icon aria-hidden />
          </Button>
        }
        title={`Excluir a task ${task.name}?`}
        description="O histórico de execuções também será removido."
        confirmLabel="Excluir"
        destructive
        onConfirm={onDelete}
      />
    </>
  );
}

function ExecutionHistory({
  projectId,
  task,
  canRun,
  running,
  onRun,
}: {
  readonly projectId: string;
  readonly task: Task;
  readonly canRun: boolean;
  readonly running: boolean;
  readonly onRun: () => void;
}) {
  const executions = useQuery({
    queryKey: ["task-executions", projectId, task.id],
    queryFn: () => listTaskExecutionsFn({ data: { projectId, taskId: task.id } }),
    refetchInterval: (query) => {
      const data = query.state.data ?? [];
      return data.some((execution) => ACTIVE_EXECUTION_STATUSES.has(execution.status))
        ? ACTIVE_EXECUTION_REFRESH_INTERVAL_IN_MS
        : false;
    },
  });
  return (
    <>
      <SheetHeader className="border-b border-border px-6 py-5">
        <SheetTitle>Execuções de {task.name}</SheetTitle>
        <SheetDescription className="font-mono text-xs">
          {formatCommandLine(task.command)}
        </SheetDescription>
        {canRun ? (
          <Button size="sm" className="mt-3 w-fit" disabled={running} onClick={onRun}>
            <PlayIcon aria-hidden />
            Executar agora
          </Button>
        ) : null}
      </SheetHeader>
      <div className="space-y-4 px-6 py-5">
        {executions.isError ? (
          <ErrorState error={executions.error} onRetry={() => void executions.refetch()} />
        ) : null}
        {executions.data == null && executions.isError === false ? <ListSkeleton rows={2} /> : null}
        {executions.data?.length === 0 ? (
          <EmptyState icon={HistoryIcon} title="Nenhuma execução ainda" />
        ) : null}
        {(executions.data ?? []).map((execution) => (
          <article
            key={execution.id}
            className="space-y-3 border-b border-border pb-4 last:border-b-0"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TaskStatusBadge status={execution.status} />
              <span className="text-xs text-faint">
                {formatDateTime(execution.startedAt ?? execution.createdAt)}
              </span>
            </div>
            <dl className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <dt className="text-faint">Origem</dt>
                <dd>{TRIGGER_LABELS[execution.trigger] ?? execution.trigger}</dd>
              </div>
              <div>
                <dt className="text-faint">Duração</dt>
                <dd className="tabular-nums">
                  {formatDuration(durationBetween(execution.startedAt, execution.finishedAt))}
                </dd>
              </div>
              <div>
                <dt className="text-faint">Código de saída</dt>
                <dd className="font-mono">{execution.exitCode ?? "—"}</dd>
              </div>
            </dl>
            {execution.errorMessage == null ? null : (
              <p className="text-sm text-destructive">{execution.errorMessage}</p>
            )}
            {execution.output === "" ? null : (
              <pre className="max-h-64 overflow-auto rounded-lg bg-console p-3 font-mono text-xs whitespace-pre-wrap text-console-foreground">
                {execution.output}
              </pre>
            )}
          </article>
        ))}
      </div>
    </>
  );
}

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

function TaskDialog({
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
