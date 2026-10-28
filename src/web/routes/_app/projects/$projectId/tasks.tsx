import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  HistoryIcon,
  InfoIcon,
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
import { PageHeader } from "@/web/components/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/states";
import { TaskStatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";
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
      <PageHeader
        title="Tasks"
        description="Comandos executados sob demanda ou por agendamento cron."
        actions={
          canWrite ? (
            <Button onClick={() => openDialog(null)}>
              <PlusIcon aria-hidden />
              Nova task
            </Button>
          ) : null
        }
      />
      <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-4 text-[0.92rem]">
        <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        Os comandos rodam dentro do contêiner atual do projeto via docker exec, como uma lista de
        argumentos: não passam por um shell e nunca executam no servidor host.
      </p>
      {tasksQuery.isError ? (
        <ErrorState error={tasksQuery.error} onRetry={() => void tasksQuery.refetch()} />
      ) : null}
      {tasksQuery.data == null && tasksQuery.isError === false ? <ListSkeleton /> : null}
      {tasksQuery.data != null && tasks.length === 0 ? (
        <EmptyState
          icon={ListChecksIcon}
          title="Nenhuma task cadastrada"
          description="Crie tasks para migrações, limpezas de cache ou rotinas agendadas."
        />
      ) : null}
      {tasks.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Comando</TableHead>
                <TableHead>Agendamento</TableHead>
                <TableHead>Próxima execução</TableHead>
                <TableHead>Ativa</TableHead>
                <TableHead>Última execução</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell className="font-medium">{task.name}</TableCell>
                  <TableCell
                    className="max-w-xs truncate font-mono text-[0.82rem]"
                    title={formatCommandLine(task.command)}
                  >
                    {formatCommandLine(task.command)}
                  </TableCell>
                  <TableCell className="font-mono text-[0.82rem]">
                    {task.schedule ?? "Manual"}
                  </TableCell>
                  <TableCell className="text-[0.92rem] text-muted-foreground">
                    {formatDateTime(task.nextRunAt)}
                  </TableCell>
                  <TableCell>
                    <Switch
                      aria-label={`Ativar ${task.name}`}
                      checked={task.enabled}
                      disabled={canWrite === false || toggle.isPending}
                      onCheckedChange={(enabled) => toggle.mutate({ task, enabled })}
                    />
                  </TableCell>
                  <TableCell>
                    {task.latestExecution == null ? (
                      <span className="text-[0.92rem] text-muted-foreground">Nunca executada</span>
                    ) : (
                      <div className="flex flex-col items-start gap-1">
                        <TaskStatusBadge status={task.latestExecution.status} />
                        <span className="text-[0.82rem] text-muted-foreground">
                          {formatDuration(
                            durationBetween(
                              task.latestExecution.startedAt,
                              task.latestExecution.finishedAt,
                            ),
                          )}
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <TaskActions
                      task={task}
                      canRun={canRun}
                      canWrite={canWrite}
                      onRun={() => run.mutate(task.id)}
                      onEdit={() => openDialog(task)}
                      onDelete={() => remove.mutate(task.id)}
                      onHistory={() => setHistoryTaskId(task.id)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {historyTask == null ? null : <ExecutionHistory projectId={projectId} task={historyTask} />}
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

function TaskActions({
  task,
  canRun,
  canWrite,
  onRun,
  onEdit,
  onDelete,
  onHistory,
}: {
  readonly task: Task;
  readonly canRun: boolean;
  readonly canWrite: boolean;
  readonly onRun: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onHistory: () => void;
}) {
  return (
    <div className="flex justify-end gap-1">
      {canRun ? (
        <Button variant="outline" size="sm" onClick={onRun}>
          <PlayIcon aria-hidden />
          Executar
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Histórico de ${task.name}`}
        onClick={onHistory}
      >
        <HistoryIcon aria-hidden />
      </Button>
      {canWrite ? (
        <>
          <Button variant="ghost" size="icon" aria-label={`Editar ${task.name}`} onClick={onEdit}>
            <PencilIcon aria-hidden />
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="icon" aria-label={`Excluir ${task.name}`}>
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Execuções de {task.name}</CardTitle>
        <CardDescription className="font-mono text-[0.82rem]">
          {formatCommandLine(task.command)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {executions.isError ? (
          <ErrorState error={executions.error} onRetry={() => void executions.refetch()} />
        ) : null}
        {executions.data == null && executions.isError === false ? <ListSkeleton rows={2} /> : null}
        {executions.data?.length === 0 ? (
          <EmptyState icon={HistoryIcon} title="Nenhuma execução ainda" />
        ) : null}
        {(executions.data ?? []).map((execution) => (
          <article key={execution.id} className="space-y-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.92rem]">
              <TaskStatusBadge status={execution.status} />
              <span>{TRIGGER_LABELS[execution.trigger] ?? execution.trigger}</span>
              <span className="text-muted-foreground">
                Início: {formatDateTime(execution.startedAt ?? execution.createdAt)}
              </span>
              <span className="text-muted-foreground">
                Fim: {formatDateTime(execution.finishedAt)}
              </span>
              <span className="text-muted-foreground">
                Duração:{" "}
                {formatDuration(durationBetween(execution.startedAt, execution.finishedAt))}
              </span>
              <span className="text-muted-foreground">
                Código de saída: {execution.exitCode ?? "—"}
              </span>
            </div>
            {execution.errorMessage == null ? null : (
              <p className="text-[0.92rem] text-destructive">{execution.errorMessage}</p>
            )}
            {execution.output === "" ? null : (
              <pre className="max-h-64 overflow-auto rounded-md bg-black/90 p-3 font-mono text-[0.82rem] whitespace-pre-wrap text-zinc-100 dark:bg-black/40">
                {execution.output}
              </pre>
            )}
          </article>
        ))}
      </CardContent>
    </Card>
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
