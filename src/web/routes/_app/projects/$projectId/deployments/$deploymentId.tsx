import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/projects/$projectId/deployments/$deploymentId")({
  component: DeploymentLayout,
});

function DeploymentLayout() {
  const params = Route.useParams();
  return (
    <>
      <nav aria-label="Páginas do deploy" className="flex flex-wrap gap-1 sm:gap-2">
        <Link
          to="/projects/$projectId/deployments/$deploymentId"
          params={params}
          activeOptions={{ exact: true }}
          className="rounded-lg px-2 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring data-[status=active]:bg-well sm:px-3"
        >
          Progresso do deploy
        </Link>
        <Link
          to="/projects/$projectId/deployments/$deploymentId/logs"
          params={params}
          className="rounded-lg px-2 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring data-[status=active]:bg-well sm:px-3"
        >
          Logs do deploy
        </Link>
      </nav>
      <Outlet />
    </>
  );
}
