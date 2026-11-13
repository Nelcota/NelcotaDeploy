import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useChildMatches } from "@tanstack/react-router";

import { ErrorState } from "@/web/components/layout/states";
import { ProjectBanners } from "@/web/components/projects/project-banners";
import { ProjectBand } from "@/web/components/projects/project-header";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { ProjectPermissionsProvider } from "@/web/components/shell/use-permissions";
import { Button } from "@/web/components/ui/button";
import { Skeleton } from "@/web/components/ui/skeleton";

export const Route = createFileRoute("/_app/projects/$projectId")({
  component: ProjectLayout,
});

function ProjectLayout() {
  const { projectId } = Route.useParams();
  const query = useQuery(projectQueryOptions(projectId));
  const viewingDeployment = useChildMatches({
    select: (matches) =>
      matches.some(
        (match) => match.routeId === "/_app/projects/$projectId/deployments/$deploymentId",
      ),
  });

  if (query.isError) {
    return (
      <div className="space-y-6">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        <Button variant="outline" asChild>
          <Link to="/projects">Voltar para projetos</Link>
        </Button>
      </div>
    );
  }
  return (
    <ProjectPermissionsProvider key={projectId} value={query.data?.permissions ?? []}>
      {query.data == null ? (
        <div className="space-y-6" aria-busy="true" aria-label="Carregando projeto">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : (
        <>
          <ProjectBand details={query.data} compact={viewingDeployment} />
          <ProjectBanners details={query.data} />
        </>
      )}
      <Outlet key={projectId} />
    </ProjectPermissionsProvider>
  );
}
