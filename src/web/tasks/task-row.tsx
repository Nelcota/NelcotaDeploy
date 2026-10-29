import { HistoryIcon, LoaderCircleIcon, PencilIcon, PlayIcon, Trash2Icon } from "lucide-react";

import { formatCommandLine } from "@/shared/command-line";
import type { Task } from "@/tasks";
import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { ListRow } from "@/web/components/layout/layout";
import { Button } from "@/web/components/ui/button";
import { Switch } from "@/web/components/ui/switch";

import { LastExecutionCell, ScheduleCell } from "./task-row-cells";

export type TaskRow = Task & {
  readonly latestExecution: {
    readonly status: string;
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
  } | null;
};

type TaskListRowProps = {
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
};

function TaskTitle({
  task,
  onOpenHistory,
}: {
  readonly task: Task;
  readonly onOpenHistory: () => void;
}) {
  const command = formatCommandLine(task.command);
  return (
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
  return (
    <div className="mr-auto flex items-center gap-2 lg:mr-2">
      <Switch
        id={`task-enabled-${task.id}`}
        aria-label={`Task ${task.name} ativa`}
        checked={task.enabled}
        disabled={disabled}
        onCheckedChange={onToggle}
      />
      <span aria-hidden className="w-14 text-xs text-muted-foreground">
        {task.enabled ? "Ativa" : "Pausada"}
      </span>
    </div>
  );
}

function RunButton({
  taskName,
  running,
  onRun,
}: {
  readonly taskName: string;
  readonly running: boolean;
  readonly onRun: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={running}
      aria-label={`Executar ${taskName}`}
      onClick={onRun}
    >
      {running ? (
        <LoaderCircleIcon aria-hidden className="animate-spin" />
      ) : (
        <PlayIcon aria-hidden />
      )}
      Executar
    </Button>
  );
}

/** One task: name, command, schedule, last execution and the row actions. */
export function TaskListRow({
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
}: TaskListRowProps) {
  return (
    <ListRow className="flex-wrap lg:flex-nowrap">
      <TaskTitle task={task} onOpenHistory={onOpenHistory} />
      <div className="grid w-full grid-cols-2 gap-4 lg:flex lg:w-auto">
        <ScheduleCell task={task} now={now} />
        <LastExecutionCell execution={task.latestExecution} now={now} />
      </div>
      <div className="flex w-full shrink-0 items-center justify-end gap-1 lg:w-auto">
        <EnabledSwitch task={task} disabled={canWrite === false || toggling} onToggle={onToggle} />
        {canRun ? <RunButton taskName={task.name} running={running} onRun={onRun} /> : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Histórico de ${task.name}`}
          title="Histórico de execuções"
          onClick={onOpenHistory}
        >
          <HistoryIcon aria-hidden />
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
