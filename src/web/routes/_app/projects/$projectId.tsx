import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  PlayIcon,
  RefreshCwIcon,
  RocketIcon,
  RotateCwIcon,
  ShieldCheckIcon,
  SquareIcon,
} from "lucide-react";

import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { type ProjectDetails, projectQueryOptions } from "@/web/components/project-query";
import { ErrorState } from "@/web/components/states";
import { ContainerStateBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { Skeleton } from "@/web/components/ui/skeleton";
import { useAction } from "@/web/components/use-action";
import { useCan } from "@/web/components/use-permissions";
import {
  containerActionFn,
  deployProjectFn,
  redeployProjectFn,
} from "@/web/functions/deployments.functions";
import { approveProjectFn } from "@/web/functions/projects.functions";

export const Route = createFileRoute("/_app/projects/$projectId")({
  component: ProjectLayout,
});

const TABS = [
  { to: "/projects/$projectId", label: "Visão geral", exact: true },
  { to: "/projects/$projectId/deployments", label: "Deploys", exact: false },
  { to: "/projects/$projectId/logs", label: "Logs", exact: false },
  { to: "/projects/$projectId/environment", label: "Variáveis", exact: false },
  { to: "/projects/$projectId/domains", label: "Domínios", exact: false },
  { to: "/projects/$projectId/tasks", label: "Tasks", exact: false },
  { to: "/projects/$projectId/metrics", label: "Métricas", exact: false },
  { to: "/projects/$projectId/settings", label: "Configurações", exact: false },
] as const;

function ProjectLayout() {
  const { projectId } = Route.useParams();
  const query = useQuery(projectQueryOptions(projectId));

  if (query.isError) {
    return (
      <div className="space-y-4">
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
      <ProjectHeader details={query.data} />
      <ProjectBanners details={query.data} />
      <nav aria-label="Seções do projeto" className="-mx-1 overflow-x-auto border-b">
        <ul className="flex min-w-max gap-1 px-1">
          {TABS.map((tab) => (
            <li key={tab.to}>
              <Link
                to={tab.to}
                params={{ projectId }}
                activeOptions={{ exact: tab.exact }}
                className="inline-block border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[status=active]:border-primary data-[status=active]:font-medium data-[status=active]:text-foreground"
              >
                {tab.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </>
  );
}

function currentContainer(details: ProjectDetails) {
  return (
    details.containers.find(
      (container) => container.deploymentId === details.project.currentDeploymentId,
    ) ?? null
  );
}

function ProjectHeader({ details }: { readonly details: ProjectDetails }) {
  const { project } = details;
  const container = currentContainer(details);
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
          <ContainerStateBadge
            state={container?.state ?? null}
            health={container?.health ?? null}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <a
            href={`https://github.com/${project.repositoryFullName}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
          >
            {project.repositoryFullName}
            <ExternalLinkIcon aria-hidden className="size-3.5" />
            <span className="sr-only">(abre em nova aba)</span>
          </a>
          <span className="inline-flex items-center gap-1 font-mono">
            <GitBranchIcon aria-hidden className="size-3.5" />
            {project.branch}
          </span>
        </div>
      </div>
      <ProjectActions details={details} hasContainer={container != null} />
    </header>
  );
}

function ProjectActions({
  details,
  hasContainer,
}: {
  readonly details: ProjectDetails;
  readonly hasContainer: boolean;
}) {
  const { project } = details;
  const projectId = project.id;
  const can = useCan();
  const navigate = useNavigate();
  const invalidate = [["project", projectId], ["deployments"], ["projects"]] as const;

  const deploy = useAction({
    action: () => deployProjectFn({ data: { projectId } }),
    successMessage: (result) =>
      result.created ? "Deploy colocado na fila" : "Já existe um deploy igual na fila",
    invalidate,
    onSuccess: async (result) => {
      await navigate({
        to: "/projects/$projectId/deployments/$deploymentId",
        params: { projectId, deploymentId: result.deploymentId },
      });
    },
  });
  const redeploy = useAction({
    action: () => redeployProjectFn({ data: { projectId } }),
    successMessage: "Redeploy colocado na fila",
    invalidate,
    onSuccess: async (result) => {
      await navigate({
        to: "/projects/$projectId/deployments/$deploymentId",
        params: { projectId, deploymentId: result.deploymentId },
      });
    },
  });
  const containerAction = useAction({
    action: (action: "start" | "stop" | "restart") =>
      containerActionFn({ data: { projectId, action } }),
    successMessage: "Ação enviada ao worker",
    invalidate,
  });

  const canDeploy = can("deployment:create") && project.deploymentsApproved;
  const canControl = can("container:control") && project.currentDeploymentId != null;
  const busy = deploy.isPending || redeploy.isPending || containerAction.isPending;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canControl ? (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || hasContainer === false}
            onClick={() => containerAction.mutate("start")}
          >
            <PlayIcon aria-hidden />
            Iniciar
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="outline" size="sm" disabled={busy || hasContainer === false}>
                <SquareIcon aria-hidden />
                Parar
              </Button>
            }
            title="Parar a aplicação?"
            description="O contêiner será parado e a aplicação ficará fora do ar até ser iniciada novamente."
            confirmLabel="Parar"
            destructive
            onConfirm={() => containerAction.mutate("stop")}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy || hasContainer === false}
            onClick={() => containerAction.mutate("restart")}
          >
            <RotateCwIcon aria-hidden />
            Reiniciar
          </Button>
        </>
      ) : null}
      {canDeploy && project.currentDeploymentId != null ? (
        <ConfirmDialog
          trigger={
            <Button variant="outline" size="sm" disabled={busy}>
              <RefreshCwIcon aria-hidden />
              Redeploy
            </Button>
          }
          title="Recriar o contêiner?"
          description="Um novo contêiner será criado com a imagem atual, aplicando as variáveis e domínios salvos, sem novo build. Pode haver uma breve troca de versão durante a substituição."
          confirmLabel="Fazer redeploy"
          onConfirm={() => redeploy.mutate()}
        />
      ) : null}
      {canDeploy ? (
        <Button size="sm" disabled={busy} onClick={() => deploy.mutate()}>
          <RocketIcon aria-hidden />
          Deploy
        </Button>
      ) : null}
    </div>
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
          className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between"
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
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm"
        >
          <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          Worker offline: deploys, ações de contêiner e tasks ficam na fila até o worker voltar.
          Verifique se o processo worker está em execução.
        </p>
      ) : null}
    </div>
  );
}
