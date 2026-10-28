import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  HistoryIcon,
  ListChecksIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { formatCommandLine } from "@/shared/command-line";
import { durationBetween, formatDateTime, formatDuration } from "@/shared/format";
import { DEFAULT_TASK_TIMEOUT_IN_SECONDS, taskInputSchema } from "@/shared/task.schema";
import type { Task } from "@/tasks";
import { ConfirmDialog } from "@/web/components/confirm-dialog";
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
  const historyTask = tasks.find((task) => task.id === historyTaskId) ?? null;

  return (
    <>
      <TabHeader
        title="Tasks"
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
              <Button variant="outline" size="sm" onClick={() => openDialog(null)}>
                <PlusIcon aria-hidden />
                Nova task
              </Button>
            ) : null
          }
        />
      ) : null}
      {tasks.length > 0 ? (
        <List>
          {tasks.map((task) => (
            <div
              key={task.id}
              role="button"
              tabIndex={0}
              aria-label={`${task.name}: abrir histórico de execuções`}
              className="cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
              onClick={() => setHistoryTaskId(task.id)}
              onKeyDown={(event) => {
                if (
                  event.target === event.currentTarget &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                  setHistoryTaskId(task.id);
                }
              }}
            >
              <ListRow
                accent={executionAccent(task.latestExecution?.status ?? null)}
                className="flex-wrap md:flex-nowrap"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm font-medium">{task.name}</p>
                  <p
                    className="truncate font-mono text-xs text-faint"
                    title={formatCommandLine(task.command)}
                  >
                    {formatCommandLine(task.command)}
                  </p>
                </div>
                <div className="hidden min-w-0 shrink-0 space-y-1 text-right text-xs md:block">
                  <p className="font-mono text-muted-foreground">{task.schedule ?? "manual"}</p>
                  <p className="text-faint">
                    {task.nextRunAt == null
                      ? "sem agendamento"
                      : `próxima ${formatDateTime(task.nextRunAt)}`}
                  </p>
                </div>
                <div className="w-36 shrink-0">
                  {task.latestExecution == null ? (
                    <span className="text-xs text-faint">nunca executada</span>
                  ) : (
                    <div className="space-y-0.5">
                      <TaskStatusBadge status={task.latestExecution.status} />
                      <p className="text-xs text-faint">
                        {formatDuration(
                          durationBetween(
                            task.latestExecution.startedAt,
                            task.latestExecution.finishedAt,
                          ),
                        )}
                      </p>
                    </div>
                  )}
                </div>
                <div
                  className="flex shrink-0 items-center gap-2"
                  onClick={stopRowClick}
                  onKeyDown={stopRowClick}
                >
                  <Switch
                    aria-label={`Ativar ${task.name}`}
                    checked={task.enabled}
                    disabled={canWrite === false || toggle.isPending}
                    onCheckedChange={(enabled) => toggle.mutate({ task, enabled })}
                  />
                  <TaskActions
                    task={task}
                    canRun={canRun}
                    canWrite={canWrite}
                    onRun={() => run.mutate(task.id)}
                    onEdit={() => openDialog(task)}
                    onDelete={() => remove.mutate(task.id)}
                  />
                </div>
              </ListRow>
            </div>
          ))}
        </List>
      ) : null}
      <details className="text-sm text-muted-foreground">
        <summary className="w-fit cursor-pointer text-xs font-medium text-faint hover:text-foreground focus-visible:text-foreground focus-visible:outline-none">
          Como os comandos são executados
        </summary>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed">
          Cada comando roda com docker exec no contêiner atual, como lista de argumentos: não passa
          por um shell e nunca executa no servidor host. Agendamentos usam o fuso {timeZone}.
        </p>
      </details>
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
            <ExecutionHistory projectId={projectId} task={historyTask} />
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

/** Keeps clicks on controls inside a row from also opening the row. */
function stopRowClick(event: { stopPropagation: () => void }): void {
  event.stopPropagation();
}

function TaskActions({
  task,
  canRun,
  canWrite,
  onRun,
  onEdit,
  onDelete,
}: {
  readonly task: Task;
  readonly canRun: boolean;
  readonly canWrite: boolean;
  readonly onRun: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <div className="flex justify-end gap-1">
      {canRun ? (
        <Button variant="ghost" size="sm" onClick={onRun}>
          <PlayIcon aria-hidden />
          Executar
        </Button>
      ) : null}
      {canWrite ? (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Editar ${task.name}`}
            onClick={onEdit}
          >
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
      ) : null}
    </div>
  );
}

function ExecutionHistory({
  projectId,
  task,
}: {
  readonly projectId: string;
  readonly task: Task;
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
              <FormField
                id="task-schedule"
                label="Agendamento"
                hint={`cron de 5 campos no fuso ${timeZone}, vazio = só manual`}
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
                    onChange={(event) => field.handleChange(event.target.valueAsNumber)}
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
