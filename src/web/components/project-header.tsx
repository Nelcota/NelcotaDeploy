import { Link, useNavigate } from "@tanstack/react-router";
import {
  EllipsisIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  PlayIcon,
  RefreshCwIcon,
  RocketIcon,
  RotateCwIcon,
  SquareIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  containerActionFn,
  deployProjectFn,
  redeployProjectFn,
} from "@/web/functions/deployments.functions";

import { ConfirmDialog } from "./confirm-dialog";
import { PROJECT_SECTIONS } from "./navigation";
import type { ProjectDetails } from "./project-query";
import { ContainerStateBadge } from "./status-badge";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useAction } from "./use-action";
import { useCan } from "./use-permissions";

/** The container of the project's current deployment, if the worker has seen it. */
export function currentContainer(details: ProjectDetails) {
  return (
    details.containers.find(
      (container) => container.deploymentId === details.project.currentDeploymentId,
    ) ?? null
  );
}

function publicUrl(details: ProjectDetails): string | null {
  const [domain] = details.domains;
  if (domain == null) {
    return null;
  }
  return `${domain.httpsEnabled ? "https" : "http"}://${domain.hostname}`;
}

/**
 * Header shared by every project page: where you are, the project's state, its address,
 * the actions, and the tabs that lead to each part of the project.
 */
export function ProjectBand({ details }: { readonly details: ProjectDetails }) {
  const { project } = details;
  const container = currentContainer(details);
  const url = publicUrl(details);
  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="truncate text-2xl leading-tight font-semibold tracking-tight">
              {project.name}
            </h1>
            <ContainerStateBadge
              state={container?.state ?? null}
              health={container?.health ?? null}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
            {url == null ? (
              <a
                href={`https://github.com/${project.repositoryFullName}`}
                target="_blank"
                rel="noreferrer noopener"
                className="font-mono transition-colors hover:text-foreground"
              >
                {project.repositoryFullName}
                <span className="sr-only"> (repositório, abre em nova aba)</span>
              </a>
            ) : (
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                className="font-mono transition-colors hover:text-foreground"
              >
                {url.replace(/^https?:\/\//, "")}
                <span className="sr-only"> (abre em nova aba)</span>
              </a>
            )}
            <span className="inline-flex items-center gap-1.5 font-mono">
              <GitBranchIcon aria-hidden className="size-3.5" />
              {project.branch}
            </span>
          </div>
        </div>
        <ProjectActions details={details} hasContainer={container != null} url={url} />
      </header>
      <ProjectTabs projectId={project.id} />
    </div>
  );
}

function ProjectTabs({ projectId }: { readonly projectId: string }) {
  return (
    <nav aria-label="Seções do projeto" className="-mx-1 overflow-x-auto px-1">
      <ul className="flex w-fit min-w-max gap-2 py-0.5">
        {PROJECT_SECTIONS.map((section) => (
          <li key={section.to}>
            <Link
              to={section.to}
              params={{ projectId }}
              activeOptions={{ exact: section.exact }}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-well px-4 text-sm text-foreground ring-1 ring-border transition-colors hover:bg-well-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[status=active]:bg-primary data-[status=active]:text-primary-foreground data-[status=active]:ring-primary"
            >
              <section.icon aria-hidden className="size-4" />
              {section.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Title row of a project tab: small heading, one line, actions on the right. */
export function TabHeader({
  title,
  description,
  actions,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description == null ? null : (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions == null ? null : <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const STOP_DESCRIPTION =
  "O contêiner será parado e a aplicação ficará fora do ar até ser iniciada novamente.";
const REDEPLOY_DESCRIPTION =
  "Um novo contêiner será criado com a imagem atual, aplicando as variáveis e domínios salvos, sem novo build. Pode haver uma breve troca de versão durante a substituição.";

function ProjectActions({
  details,
  hasContainer,
  url,
}: {
  readonly details: ProjectDetails;
  readonly hasContainer: boolean;
  readonly url: string | null;
}) {
  const { project } = details;
  const projectId = project.id;
  const can = useCan();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState<"stop" | "redeploy" | null>(null);
  const invalidate = [["project", projectId], ["deployments"], ["projects"]] as const;
  const openDeployment = async (result: { deploymentId: string }) => {
    await navigate({
      to: "/projects/$projectId/deployments/$deploymentId",
      params: { projectId, deploymentId: result.deploymentId },
    });
  };

  const deploy = useAction({
    action: () => deployProjectFn({ data: { projectId } }),
    successMessage: (result) =>
      result.created ? "Deploy colocado na fila" : "Já existe um deploy igual na fila",
    invalidate,
    onSuccess: openDeployment,
  });
  const redeploy = useAction({
    action: () => redeployProjectFn({ data: { projectId } }),
    successMessage: "Redeploy colocado na fila",
    invalidate,
    onSuccess: openDeployment,
  });
  const containerAction = useAction({
    action: (action: "start" | "stop" | "restart") =>
      containerActionFn({ data: { projectId, action } }),
    successMessage: "Ação enviada ao worker",
    invalidate,
  });

  const canDeploy = can("deployment:create") && project.deploymentsApproved;
  const canControl = can("container:control") && project.currentDeploymentId != null;
  const canRedeploy = canDeploy && project.currentDeploymentId != null;
  const busy = deploy.isPending || redeploy.isPending || containerAction.isPending;
  const containerDisabled = busy || hasContainer === false;

  return (
    <div className="flex items-center gap-2">
      {url == null ? null : (
        <Button variant="outline" size="sm" asChild>
          <a href={url} target="_blank" rel="noreferrer noopener">
            <ExternalLinkIcon aria-hidden />
            Abrir
            <span className="sr-only"> a aplicação em nova aba</span>
          </a>
        </Button>
      )}
      {canControl || canRedeploy ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="Mais ações">
              <EllipsisIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {canControl ? (
              <>
                <DropdownMenuItem
                  disabled={containerDisabled}
                  onSelect={() => containerAction.mutate("start")}
                >
                  <PlayIcon aria-hidden />
                  Iniciar
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={containerDisabled}
                  onSelect={() => containerAction.mutate("restart")}
                >
                  <RotateCwIcon aria-hidden />
                  Reiniciar
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={containerDisabled}
                  onSelect={() => setConfirming("stop")}
                >
                  <SquareIcon aria-hidden />
                  Parar
                </DropdownMenuItem>
              </>
            ) : null}
            {canControl && canRedeploy ? <DropdownMenuSeparator /> : null}
            {canRedeploy ? (
              <DropdownMenuItem disabled={busy} onSelect={() => setConfirming("redeploy")}>
                <RefreshCwIcon aria-hidden />
                Redeploy sem build
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {canDeploy ? (
        <Button size="sm" disabled={busy} onClick={() => deploy.mutate()}>
          <RocketIcon aria-hidden />
          Deploy
        </Button>
      ) : null}
      <ConfirmDialog
        open={confirming === "stop"}
        onOpenChange={(open) => setConfirming(open ? "stop" : null)}
        title="Parar a aplicação?"
        description={STOP_DESCRIPTION}
        confirmLabel="Parar"
        destructive
        onConfirm={() => containerAction.mutate("stop")}
      />
      <ConfirmDialog
        open={confirming === "redeploy"}
        onOpenChange={(open) => setConfirming(open ? "redeploy" : null)}
        title="Recriar o contêiner?"
        description={REDEPLOY_DESCRIPTION}
        confirmLabel="Fazer redeploy"
        onConfirm={() => redeploy.mutate()}
      />
    </div>
  );
}
