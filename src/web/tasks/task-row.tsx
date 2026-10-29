import {
  CalendarClockIcon,
  HandIcon,
  HistoryIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";

import { formatCommandLine } from "@/shared/command-line";
import {
  durationBetween,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
} from "@/shared/format";
import type { Task } from "@/tasks";
import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { ListRow } from "@/web/components/layout/layout";
import { TaskStatusBadge } from "@/web/components/layout/status-badge";
import { describeCronSchedule } from "@/web/components/projects/cron-description";
import { Button } from "@/web/components/ui/button";
import { Switch } from "@/web/components/ui/switch";

export type TaskRow = Task & {
  readonly latestExecution: {
    readonly status: string;
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
  } | null;
};

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
  return (
    <ListRow className="flex-wrap lg:flex-nowrap">
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

function ScheduleCell({ task, now }: { readonly task: TaskRow; readonly now: Date }) {
  if (task.schedule == null) {
    return (
      <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground lg:w-44 lg:shrink-0">
        <HandIcon aria-hidden className="size-3.5 shrink-0" />
        Sob demanda
      </p>
    );
  }
  const description = describeCronSchedule(task.schedule);
  return (
    <div className="min-w-0 space-y-0.5 text-xs lg:w-44 lg:shrink-0">
      <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground" title={task.schedule}>
        <CalendarClockIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">
          {description ?? <span className="font-mono">{task.schedule}</span>}
        </span>
      </p>
      {task.enabled && task.nextRunAt != null ? (
        <p className="truncate pl-5 text-muted-foreground" title={formatDateTime(task.nextRunAt)}>
          próxima {formatRelativeTime(task.nextRunAt, now)}
        </p>
      ) : null}
      {task.enabled ? null : (
        <p className="truncate pl-5 text-muted-foreground">não roda enquanto pausada</p>
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
      <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground lg:w-36 lg:shrink-0">
        <HistoryIcon aria-hidden className="size-3.5 shrink-0" />
        Nunca executada
      </p>
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
