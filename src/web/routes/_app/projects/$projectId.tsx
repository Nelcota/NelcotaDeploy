import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { AlertTriangleIcon, ShieldCheckIcon } from "lucide-react";

import { type ProjectDetails, projectQueryOptions } from "@/web/components/project-query";
import { ErrorState } from "@/web/components/states";
import { Button } from "@/web/components/ui/button";
import { Skeleton } from "@/web/components/ui/skeleton";
import { useAction } from "@/web/components/use-action";
import { useCan } from "@/web/components/use-permissions";
import { approveProjectFn } from "@/web/functions/projects.functions";

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
      <div className="space-y-4" aria-busy="true" aria-label="Carregando projeto">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return (
    <>
      <ProjectBanners details={query.data} />
      <Outlet />
    </>
  );
}

function ProjectBanners({ details }: { readonly details: ProjectDetails }) {
  const { project, worker } = details;
  const can = useCan();
  const approve = useAction({
    action: () => approveProjectFn({ data: { projectId: project.id } }),
    successMessage: "Projeto aprovado para deploy",
    invalidate: [["project", project.id], ["projects"]],
  });
  const workerOffline = worker == null || worker.online === false;
  if (project.deploymentsApproved && workerOffline === false) {
    return null;
  }
  return (
    <div className="space-y-3">
      {project.deploymentsApproved ? null : (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-xl border border-warning/35 bg-warning/10 p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2 text-sm">
            <ShieldCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            Este projeto aguarda aprovação de um administrador. O build executa código do
            repositório, por isso nenhum deploy roda antes da aprovação.
          </p>
          {can("project:approve") ? (
            <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate()}>
              Aprovar
            </Button>
          ) : null}
        </div>
      )}
      {workerOffline ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-destructive/35 bg-destructive/10 p-5 text-sm"
        >
          <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          Worker offline: deploys, ações de contêiner e tasks ficam na fila até o worker voltar.
          Verifique se o processo worker está em execução.
        </p>
      ) : null}
    </div>
  );
}
