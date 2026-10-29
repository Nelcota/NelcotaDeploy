import { CalendarClockIcon, HandIcon, HistoryIcon } from "lucide-react";

import {
  durationBetween,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
} from "@/shared/format";
import { TaskStatusBadge } from "@/web/components/layout/status-badge";
import { describeCronSchedule } from "@/web/components/projects/cron-description";

import { scheduleNote } from "./schedule-note";
import type { TaskRow } from "./task-row";

/** When the task runs next, or that it only runs on demand. */
export function ScheduleCell({ task, now }: { readonly task: TaskRow; readonly now: Date }) {
  if (task.schedule == null) {
    return (
      <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground lg:w-44 lg:shrink-0">
        <HandIcon aria-hidden className="size-3.5 shrink-0" />
        Sob demanda
      </p>
    );
  }
  const description = describeCronSchedule(task.schedule);
  const note = scheduleNote(task);
  return (
    <div className="min-w-0 space-y-0.5 text-xs lg:w-44 lg:shrink-0">
      <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground" title={task.schedule}>
        <CalendarClockIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">
          {description ?? <span className="font-mono">{task.schedule}</span>}
        </span>
      </p>
      {note?.kind === "next" ? (
        <p className="truncate pl-5 text-muted-foreground" title={formatDateTime(note.at)}>
          próxima {formatRelativeTime(note.at, now)}
        </p>
      ) : null}
      {note?.kind === "paused" ? (
        <p className="truncate pl-5 text-muted-foreground">não roda enquanto pausada</p>
      ) : null}
    </div>
  );
}

/** Status and timing of the latest execution. */
export function LastExecutionCell({
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
