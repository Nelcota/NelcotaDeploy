import { createFileRoute } from "@tanstack/react-router";

import { TasksPage } from "@/web/tasks";

export const Route = createFileRoute("/_app/projects/$projectId/tasks")({
  head: () => ({ meta: [{ title: "Tasks · Nelcota Deploy" }] }),
  component: TasksRoute,
});

function TasksRoute() {
  const { projectId } = Route.useParams();
  return <TasksPage projectId={projectId} />;
}
