import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { AlertTriangleIcon, LoaderCircleIcon, ShieldCheckIcon } from "lucide-react";

import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { ProjectBand } from "@/web/components/project-header";
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
          className="flex flex-col gap-3 rounded-xl bg-warning/8 px-5 py-4 ring-1 ring-warning/25 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2 text-sm">
            <ShieldCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            Este projeto aguarda aprovação de um administrador. O build executa código do
            repositório, por isso nenhum deploy roda antes da aprovação.
          </p>
          {can("project:approve") ? (
            <ConfirmDialog
              trigger={
                <Button size="sm" disabled={approve.isPending}>
                  {approve.isPending ? (
                    <LoaderCircleIcon aria-hidden className="animate-spin" />
                  ) : null}
                  Aprovar
                </Button>
              }
              title="Aprovar deploys deste projeto?"
              description={`O Dockerfile de ${project.repositoryFullName} (branch ${project.branch}) poderá ser executado neste servidor.`}
              confirmLabel="Aprovar"
              onConfirm={() => approve.mutate()}
            />
          ) : null}
        </div>
      )}
      {workerOffline ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-destructive/8 px-5 py-4 text-sm ring-1 ring-destructive/25"
        >
          <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          Worker offline: deploys, ações de contêiner e tasks ficam na fila até o worker voltar.
          Verifique se o processo worker está em execução.
        </p>
      ) : null}
    </div>
  );
}
