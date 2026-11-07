import { Link } from "@tanstack/react-router";

import { ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { Button } from "@/web/components/ui/button";

import { ExecutionHistory } from "../execution-history";
import { useTasksQuery } from "../task-query";

/** Opens one task's execution history through a bookmarkable project-scoped URL. */
export function TaskHistoryPage({
  projectId,
  taskId,
}: {
  readonly projectId: string;
  readonly taskId: string;
}) {
  const query = useTasksQuery(projectId);
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (query.data == null) {
    return <ListSkeleton rows={2} />;
  }
  const task = query.data.tasks.find((item) => item.id === taskId);
  return (
    <>
      <Button variant="outline" asChild>
        <Link to="/projects/$projectId/tasks" params={{ projectId }}>
          Voltar para tarefas da aplicação
        </Link>
      </Button>
      {task == null ? (
        <p role="alert">Tarefa não encontrada neste projeto.</p>
      ) : (
        <ExecutionHistory projectId={projectId} task={task} />
      )}
    </>
  );
}
