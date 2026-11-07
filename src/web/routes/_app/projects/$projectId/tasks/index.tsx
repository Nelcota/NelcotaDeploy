import { createFileRoute } from "@tanstack/react-router";

import { TasksPage } from "@/web/tasks";

export const Route = createFileRoute("/_app/projects/$projectId/tasks/")({
  head: () => ({ meta: [{ title: "Tarefas da aplicação · Nelcota Deploy" }] }),
  component: PageRoute,
});

function PageRoute() {
  const { projectId } = Route.useParams();
  return <TasksPage projectId={projectId} />;
}
