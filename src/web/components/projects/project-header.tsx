import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  EllipsisIcon,
  FolderGit2Icon,
  LoaderCircleIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GlobeIcon,
  PlayIcon,
  RefreshCwIcon,
  RocketIcon,
  RotateCwIcon,
  SquareIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { ContainerStateBadge } from "@/web/components/layout/status-badge";
import { useAction } from "@/web/components/layout/use-action";
import type { ProjectDetails } from "@/web/components/projects/project-query";
import { PROJECT_SECTIONS } from "@/web/components/shell/navigation";
import { useCan } from "@/web/components/shell/use-permissions";
import { Button } from "@/web/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/web/components/ui/dropdown-menu";
import {
  containerActionFn,
  deployProjectFn,
  redeployProjectFn,
} from "@/web/functions/deployments.functions";

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
const HEADER_LINK =
  "max-w-full min-w-0 truncate rounded-sm font-mono transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function ProjectBand({ details }: { readonly details: ProjectDetails }) {
  const { project } = details;
  const container = currentContainer(details);
  const url = publicUrl(details);
  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="max-w-full min-w-0 truncate text-2xl leading-tight font-semibold tracking-tight">
              {project.name}
            </h1>
            <ContainerStateBadge
              state={container?.state ?? null}
              health={container?.health ?? null}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
            {url == null ? null : (
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                title={url}
                className={`${HEADER_LINK} inline-flex items-center gap-1.5`}
              >
                <GlobeIcon aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
                <span className="sr-only"> (abre em nova aba)</span>
              </a>
            )}
            <a
              href={`https://github.com/${project.repositoryFullName}`}
              target="_blank"
              rel="noreferrer noopener"
              title={project.repositoryFullName}
              className={`${HEADER_LINK} inline-flex items-center gap-1.5`}
            >
              <FolderGit2Icon aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{project.repositoryFullName}</span>
              <span className="sr-only"> (repositório no GitHub, abre em nova aba)</span>
            </a>
            <span className="inline-flex items-center gap-1.5 font-mono">
              <GitBranchIcon aria-hidden className="size-3.5" />
              {project.branch}
            </span>
          </div>
        </div>
        <ProjectActions details={details} containerState={container?.state ?? null} url={url} />
      </header>
      <ProjectTabs projectId={project.id} />
    </div>
  );
}

function ProjectTabs({ projectId }: { readonly projectId: string }) {
  const navRef = useRef<HTMLElement>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // On narrow screens the tabs scroll sideways; keep the open one in view.
  useEffect(() => {
    navRef.current
      ?.querySelector("[data-status=active]")
      ?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [pathname]);
  return (
    <nav
      ref={navRef}
      aria-label="Seções do projeto"
      className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]"
    >
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

/**
 * Title row of a project tab: a heading with an optional count, one line of description and
 * the actions on the right. No icon here: the selected tab right above already shows it.
 */
export function TabHeader({
  title,
  count,
  description,
  actions,
}: {
  readonly title: ReactNode;
  /** Number of items listed in the tab; omitted while loading. */
  readonly count?: number | null;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="min-w-0 space-y-0.5">
          <h2 className="flex items-center gap-2.5 text-xl leading-tight font-semibold tracking-tight">
            {title}
            {count == null ? null : (
              <span className="rounded-md bg-well px-1.5 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
                {count}
              </span>
            )}
          </h2>
          {description == null ? null : (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {actions == null ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

const STOP_DESCRIPTION =
  "O contêiner será parado e a aplicação ficará fora do ar até ser iniciada novamente.";
const REDEPLOY_DESCRIPTION =
  "Um novo contêiner será criado com a imagem atual, aplicando as variáveis e domínios salvos, sem novo build. Pode haver uma breve troca de versão durante a substituição.";

function ProjectActions({
  details,
  containerState,
  url,
}: {
  readonly details: ProjectDetails;
  /** State of the live container, or null when there is none. */
  readonly containerState: string | null;
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
  const running = containerState === "running";

  return (
    <div className="flex items-center gap-2 max-lg:border-b max-lg:border-border/70 max-lg:pb-4">
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
                {containerState == null ? (
                  <DropdownMenuItem disabled>Nenhum contêiner ativo</DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuItem
                      disabled={busy || running}
                      onSelect={() => containerAction.mutate("start")}
                    >
                      <PlayIcon aria-hidden />
                      Iniciar
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={busy || running === false}
                      onSelect={() => containerAction.mutate("restart")}
                    >
                      <RotateCwIcon aria-hidden />
                      Reiniciar
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={busy || running === false}
                      onSelect={() => setConfirming("stop")}
                    >
                      <SquareIcon aria-hidden />
                      Parar
                    </DropdownMenuItem>
                  </>
                )}
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
          {deploy.isPending ? (
            <LoaderCircleIcon aria-hidden className="animate-spin" />
          ) : (
            <RocketIcon aria-hidden />
          )}
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
