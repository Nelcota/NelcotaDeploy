import { useQuery } from "@tanstack/react-query";
import { HistoryIcon } from "lucide-react";

import { formatCommandLine } from "@/shared/command-line";
import { durationBetween, formatDateTime, formatDuration } from "@/shared/format";
import type { Task } from "@/tasks";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { TaskStatusBadge } from "@/web/components/layout/status-badge";
import { TabHeader } from "@/web/components/projects/project-header";
import { listTaskExecutionsFn } from "@/web/functions/tasks.functions";

import { TaskExecutionOutput } from "./automation/task-execution-output";
import { taskHistoryRefreshInterval } from "./automation/task-history";

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  schedule: "Agendada",
  mcp: "MCP",
};

type Execution = Awaited<ReturnType<typeof listTaskExecutionsFn>>[number];

function ExecutionCard({ execution }: { readonly execution: Execution }) {
  return (
    <article className="min-w-0 space-y-3 border-b border-border pb-4 last:border-b-0">
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
      <TaskExecutionOutput output={execution.output} errorMessage={execution.errorMessage} />
    </article>
  );
}

/** Discovers new executions at rest and follows queued or running executions more frequently. */
function useTaskExecutions(projectId: string, taskId: string) {
  return useQuery({
    queryKey: ["task-executions", projectId, taskId],
    queryFn: () => listTaskExecutionsFn({ data: { projectId, taskId } }),
    refetchInterval: (query) => taskHistoryRefreshInterval(query.state.data ?? []),
  });
}

/** Past executions and their output, independent from scheduling and running a task. */
export function ExecutionHistory({
  projectId,
  task,
}: {
  readonly projectId: string;
  readonly task: Task;
}) {
  const executions = useTaskExecutions(projectId, task.id);
  return (
    <>
      <div className="space-y-4">
        <TabHeader
          title={`Histórico de execuções de ${task.name}`}
          description="Novas execuções e resultados aparecem automaticamente."
        />
        <details className="min-w-0 rounded-lg bg-secondary/50 p-3">
          <summary className="w-fit cursor-pointer rounded text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">
            Ver comando atual
          </summary>
          <pre
            tabIndex={0}
            aria-label="Comando atual"
            className="mt-2 max-h-24 overflow-auto font-mono text-xs whitespace-pre-wrap break-all focus-visible:outline-2 focus-visible:outline-ring"
          >
            {formatCommandLine(task.command)}
          </pre>
        </details>
      </div>
      <div className="min-w-0 space-y-4">
        {executions.isError ? (
          <ErrorState error={executions.error} onRetry={() => void executions.refetch()} />
        ) : null}
        {executions.data == null && executions.isError === false ? <ListSkeleton rows={2} /> : null}
        {executions.data?.length === 0 ? (
          <EmptyState icon={HistoryIcon} title="Nenhuma execução ainda" />
        ) : null}
        {(executions.data ?? []).map((execution) => (
          <ExecutionCard key={execution.id} execution={execution} />
        ))}
      </div>
    </>
  );
}
