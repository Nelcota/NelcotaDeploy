import { Link } from "@tanstack/react-router";
import { HistoryIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { formatCommandLine } from "@/shared/command-line";
import type { Task } from "@/tasks";
import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { ListRow } from "@/web/components/layout/layout";
import { Button } from "@/web/components/ui/button";
import { Switch } from "@/web/components/ui/switch";

import { TaskRunButton } from "./automation/task-run-button";
import { LastExecutionCell, ScheduleCell } from "./task-row-cells";

export type TaskRow = Task & {
  readonly latestExecution: {
    readonly status: string;
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
  } | null;
};

type TaskListRowProps = {
  readonly projectId: string;
  readonly task: TaskRow;
  readonly now: Date;
  readonly canRun: boolean;
  readonly canWrite: boolean;
  readonly toggling: boolean;
  /** This task's run request is on its way, so another click would queue it twice. */
  readonly running: boolean;
  readonly onToggle: (enabled: boolean) => void;
  readonly onRun: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
};

function TaskTitle({ task, projectId }: { readonly task: Task; readonly projectId: string }) {
  const command = formatCommandLine(task.command);
  return (
    <div className="min-w-0 flex-1 basis-56 space-y-1">
      <p className="flex min-w-0 items-center gap-2">
        <Link
          to="/projects/$projectId/tasks/$taskId/history"
          params={{ projectId, taskId: task.id }}
          className="min-w-0 truncate rounded-sm text-left text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          title="Abrir histórico de execuções"
        >
          {task.name}
          <span className="sr-only">: abrir histórico de execuções</span>
        </Link>
      </p>
      <code className="block truncate font-mono text-xs text-muted-foreground" title={command}>
        {command}
      </code>
    </div>
  );
}

function EnabledSwitch({
  task,
  disabled,
  onToggle,
}: {
  readonly task: Task;
  readonly disabled: boolean;
  readonly onToggle: (enabled: boolean) => void;
}) {
  const [review, setReview] = useState(false);
  return (
    <>
      <div className="mr-auto flex basis-full items-center gap-2 sm:basis-auto lg:mr-2">
        <Switch
          id={`task-enabled-${task.id}`}
          aria-label={`Tarefa ${task.name} habilitada`}
          checked={task.enabled}
          disabled={disabled}
          onCheckedChange={(enabled) => {
            if (enabled && task.schedule != null) {
              setReview(true);
              return;
            }
            onToggle(enabled);
          }}
        />
        <span aria-hidden className="w-14 text-xs text-muted-foreground">
          {task.enabled ? "Ativa" : "Pausada"}
        </span>
      </div>
      <ConfirmDialog
        open={review}
        onOpenChange={setReview}
        title="Reativar o agendamento?"
        description={
          <div className="space-y-2">
            <p>{task.name} voltará a executar automaticamente conforme o agendamento salvo.</p>
            <pre className="font-mono text-xs whitespace-pre-wrap break-all">
              {formatCommandLine(task.command)}
            </pre>
            <p className="font-mono text-xs">{task.schedule}</p>
          </div>
        }
        confirmLabel="Reativar agendamento da tarefa"
        onConfirm={() => onToggle(true)}
      />
    </>
  );
}

/** One task: name, command, schedule, last execution and the row actions. */
export function TaskListRow({
  projectId,
  task,
  now,
  canRun,
  canWrite,
  toggling,
  running,
  onToggle,
  onRun,
  onEdit,
  onDelete,
}: TaskListRowProps) {
  return (
    <ListRow className="flex-wrap lg:flex-wrap">
      <TaskTitle task={task} projectId={projectId} />
      <div className="grid w-full grid-cols-2 gap-4 lg:flex lg:w-auto">
        <ScheduleCell task={task} now={now} />
        <LastExecutionCell execution={task.latestExecution} now={now} />
      </div>
      <div className="flex w-full shrink-0 flex-wrap items-center gap-x-1 gap-y-3 lg:w-auto lg:flex-wrap lg:justify-end">
        <EnabledSwitch task={task} disabled={canWrite === false || toggling} onToggle={onToggle} />
        {canRun ? <TaskRunButton task={task} pending={running} onRun={onRun} /> : null}
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Ver histórico de execuções de ${task.name}`}
          title="Histórico de execuções"
          asChild
        >
          <Link
            to="/projects/$projectId/tasks/$taskId/history"
            params={{ projectId, taskId: task.id }}
          >
            <HistoryIcon aria-hidden />
            Ver execuções
          </Link>
        </Button>
        {canWrite ? <TaskActions task={task} onEdit={onEdit} onDelete={onDelete} /> : null}
      </div>
    </ListRow>
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
      <Button variant="ghost" size="sm" aria-label={`Editar tarefa ${task.name}`} onClick={onEdit}>
        <PencilIcon aria-hidden />
        Editar tarefa
      </Button>
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="sm" aria-label={`Excluir tarefa ${task.name}`}>
            <Trash2Icon aria-hidden />
            Excluir tarefa
          </Button>
        }
        title={`Excluir a tarefa ${task.name}?`}
        description="O histórico de execuções também será removido."
        confirmLabel="Excluir tarefa e histórico"
        destructive
        onConfirm={onDelete}
      />
    </>
  );
}
