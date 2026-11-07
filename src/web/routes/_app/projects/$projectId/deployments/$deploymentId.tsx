import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/projects/$projectId/deployments/$deploymentId")({
  component: DeploymentLayout,
});

function DeploymentLayout() {
  const params = Route.useParams();
  return (
    <>
      <nav aria-label="Páginas do deploy" className="flex flex-wrap gap-2">
        <Link
          to="/projects/$projectId/deployments/$deploymentId"
          params={params}
          activeOptions={{ exact: true }}
          className="rounded-lg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring data-[status=active]:bg-well"
        >
          Progresso do deploy
        </Link>
        <Link
          to="/projects/$projectId/deployments/$deploymentId/logs"
          params={params}
          className="rounded-lg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring data-[status=active]:bg-well"
        >
          Logs da construção da imagem
        </Link>
      </nav>
      <Outlet />
    </>
  );
}
