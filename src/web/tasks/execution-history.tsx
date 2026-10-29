import { useQuery } from "@tanstack/react-query";
import { HistoryIcon, PlayIcon } from "lucide-react";

import { formatCommandLine } from "@/shared/command-line";
import { durationBetween, formatDateTime, formatDuration } from "@/shared/format";
import type { Task } from "@/tasks";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { TaskStatusBadge } from "@/web/components/layout/status-badge";
import { Button } from "@/web/components/ui/button";
import { SheetDescription, SheetHeader, SheetTitle } from "@/web/components/ui/sheet";
import { listTaskExecutionsFn } from "@/web/functions/tasks.functions";

const ACTIVE_EXECUTION_REFRESH_INTERVAL_IN_MS = 3000;
const ACTIVE_EXECUTION_STATUSES: ReadonlySet<string> = new Set(["queued", "running"]);

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  schedule: "Agendada",
  mcp: "MCP",
};

export function ExecutionHistory({
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
