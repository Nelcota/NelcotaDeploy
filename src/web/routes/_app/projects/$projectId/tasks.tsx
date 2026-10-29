import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { InfoIcon, ListChecksIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import type { Task } from "@/tasks";
import { useNow } from "@/web/components/clock/use-now";
import { List } from "@/web/components/layout/layout";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { useAction } from "@/web/components/layout/use-action";
import { TabHeader } from "@/web/components/projects/project-header";
import { useCan } from "@/web/components/shell/use-permissions";
import { Button } from "@/web/components/ui/button";
import { Sheet, SheetContent } from "@/web/components/ui/sheet";
import {
  deleteTaskFn,
  listTasksFn,
  runTaskFn,
  updateTaskFn,
} from "@/web/functions/tasks.functions";
import {
  ExecutionHistory,
  TaskDialog,
  TaskListRow,
  type TaskRow,
  toTaskFormValues,
} from "@/web/tasks";

export const Route = createFileRoute("/_app/projects/$projectId/tasks")({
  head: () => ({ meta: [{ title: "Tasks · Nelcota Deploy" }] }),
  component: TasksPage,
});

const TASKS_REFRESH_INTERVAL_IN_MS = 10_000;

function TasksPage() {
  const now = useNow();
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
