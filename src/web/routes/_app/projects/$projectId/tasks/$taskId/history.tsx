import { createFileRoute } from "@tanstack/react-router";

import { TaskHistoryPage } from "@/web/tasks";

export const Route = createFileRoute("/_app/projects/$projectId/tasks/$taskId/history")({
  head: () => ({ meta: [{ title: "Histórico de execuções da tarefa · Nelcota Deploy" }] }),
  component: PageRoute,
});

function PageRoute() {
  const { projectId, taskId } = Route.useParams();
  return <TaskHistoryPage projectId={projectId} taskId={taskId} />;
}
