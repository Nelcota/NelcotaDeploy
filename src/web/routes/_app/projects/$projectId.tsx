import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { ErrorState } from "@/web/components/layout/states";
import { ProjectBanners } from "@/web/components/projects/project-banners";
import { ProjectBand } from "@/web/components/projects/project-header";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { Button } from "@/web/components/ui/button";
import { Skeleton } from "@/web/components/ui/skeleton";

export const Route = createFileRoute("/_app/projects/$projectId")({
  component: ProjectLayout,
});

function ProjectLayout() {
  const { projectId } = Route.useParams();
  const query = useQuery(projectQueryOptions(projectId));

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
  if (query.data == null) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Carregando projeto">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return (
    <>
      <ProjectBand details={query.data} />
      <ProjectBanners details={query.data} />
      <Outlet />
    </>
  );
}
