import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  BoxIcon,
  EllipsisIcon,
  GitBranchIcon,
  GitForkIcon,
  PlayIcon,
  RefreshCwIcon,
  RocketIcon,
  RotateCwIcon,
  SquareIcon,
} from "lucide-react";
import { useState } from "react";

import { formatRelativeTime, formatShortTime } from "@/shared/format";
import {
  containerActionFn,
  deployProjectFn,
  getDeploymentFn,
  redeployProjectFn,
} from "@/web/functions/deployments.functions";

import { ConfirmDialog } from "./confirm-dialog";
import { MetricStrip } from "./overview";
import type { ProjectDetails } from "./project-query";
import { ContainerStateBadge } from "./status-badge";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useAction } from "./use-action";
import { useCan } from "./use-permissions";

const SHORT_SHA_LENGTH = 7;

function currentContainer(details: ProjectDetails) {
  return (
    details.containers.find(
      (container) => container.deploymentId === details.project.currentDeploymentId,
    ) ?? null
  );
}

function containerLabel(container: ReturnType<typeof currentContainer>): string {
  if (container == null) {
    return "—";
  }
  return container.state === "running" ? "Online" : "Parado";
}

/**
 * Title, status, repository, actions and key figures of a project, shown on its overview.
 */
export function ProjectHeader({ details }: { readonly details: ProjectDetails }) {
  const { project } = details;
  const container = currentContainer(details);
  const latest = useQuery({
    queryKey: ["deployment", project.currentDeploymentId],
    queryFn: () => getDeploymentFn({ data: { deploymentId: project.currentDeploymentId ?? "" } }),
    enabled: project.currentDeploymentId != null,
  });
  const now = new Date();
  return (
    <section className="flex flex-col gap-6 2xl:flex-row 2xl:items-start 2xl:justify-between">
      <div className="min-w-0 flex-1 space-y-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-3xl leading-tight font-medium tracking-tight">
              {project.name}
            </h1>
            <ContainerStateBadge
              state={container?.state ?? null}
              health={container?.health ?? null}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <a
              href={`https://github.com/${project.repositoryFullName}`}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline"
            >
              <GitForkIcon aria-hidden className="size-4" />
              {project.repositoryFullName}
              <span className="sr-only">(abre em nova aba)</span>
            </a>
            <span className="inline-flex items-center gap-1.5 font-mono">
              <GitBranchIcon aria-hidden className="size-4" />
              {project.branch}
            </span>
          </div>
        </div>
        <ProjectActions details={details} hasContainer={container != null} />
      </div>
      <MetricStrip
        className="2xl:w-[40rem] 2xl:shrink-0"
        metrics={[
          {
            label: "Contêiner",
            icon: BoxIcon,
            tone: container?.state === "running" ? "success" : "neutral",
            value: containerLabel(container),
            detail:
              container?.startedAt == null
                ? "nunca iniciado"
                : `iniciado ${formatRelativeTime(container.startedAt, now)}`,
          },
          {
            label: "Último deploy",
            icon: RocketIcon,
            value:
              latest.data == null
                ? "—"
                : formatShortTime(latest.data.finishedAt ?? latest.data.createdAt),
            detail:
              latest.data?.commitSha == null
                ? "sem deploy concluído"
                : `commit ${latest.data.commitSha.slice(0, SHORT_SHA_LENGTH)}`,
          },
          {
            label: "Reinícios",
            icon: RotateCwIcon,
            tone: (container?.restartCount ?? 0) > 0 ? "warning" : "neutral",
            value: container?.restartCount ?? 0,
            detail:
              (container?.restartCount ?? 0) > 0 ? "desde o último deploy" : "contêiner estável",
          },
        ]}
      />
    </section>
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

  const stopDescription =
    "O contêiner será parado e a aplicação ficará fora do ar até ser iniciada novamente.";
  const redeployDescription =
    "Um novo contêiner será criado com a imagem atual, aplicando as variáveis e domínios salvos, sem novo build. Pode haver uma breve troca de versão durante a substituição.";
  const canRedeploy = canDeploy && project.currentDeploymentId != null;
  const containerDisabled = busy || hasContainer === false;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canDeploy ? (
        <Button size="sm" disabled={busy} onClick={() => deploy.mutate()}>
          <RocketIcon aria-hidden />
          Deploy
        </Button>
      ) : null}
      <div className="hidden flex-wrap items-center gap-2 sm:flex">
        {canControl ? (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={containerDisabled}
              onClick={() => containerAction.mutate("start")}
            >
              <PlayIcon aria-hidden />
              Iniciar
            </Button>
            <ConfirmDialog
              trigger={
                <Button variant="outline" size="sm" disabled={containerDisabled}>
                  <SquareIcon aria-hidden />
                  Parar
                </Button>
              }
              title="Parar a aplicação?"
              description={stopDescription}
              confirmLabel="Parar"
              destructive
              onConfirm={() => containerAction.mutate("stop")}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={containerDisabled}
              onClick={() => containerAction.mutate("restart")}
            >
              <RotateCwIcon aria-hidden />
              Reiniciar
            </Button>
          </>
        ) : null}
        {canRedeploy ? (
          <ConfirmDialog
            trigger={
              <Button variant="outline" size="sm" disabled={busy}>
                <RefreshCwIcon aria-hidden />
                Redeploy
              </Button>
            }
            title="Recriar o contêiner?"
            description={redeployDescription}
            confirmLabel="Fazer redeploy"
            onConfirm={() => redeploy.mutate()}
          />
        ) : null}
      </div>
      {canControl || canRedeploy ? (
        <MobileActionsMenu
          canControl={canControl}
          canRedeploy={canRedeploy}
          containerDisabled={containerDisabled}
          busy={busy}
          onAction={(action) => containerAction.mutate(action)}
          onRedeploy={() => redeploy.mutate()}
          stopDescription={stopDescription}
          redeployDescription={redeployDescription}
        />
      ) : null}
    </div>
  );
}

/** On small screens the secondary actions live in a "⋯" menu so the header stays on one line. */
function MobileActionsMenu({
  canControl,
  canRedeploy,
  containerDisabled,
  busy,
  onAction,
  onRedeploy,
  stopDescription,
  redeployDescription,
}: {
  readonly canControl: boolean;
  readonly canRedeploy: boolean;
  readonly containerDisabled: boolean;
  readonly busy: boolean;
  readonly onAction: (action: "start" | "stop" | "restart") => void;
  readonly onRedeploy: () => void;
  readonly stopDescription: string;
  readonly redeployDescription: string;
}) {
  const [confirming, setConfirming] = useState<"stop" | "redeploy" | null>(null);
  return (
    <div className="sm:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label="Mais ações">
            <EllipsisIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {canControl ? (
            <>
              <DropdownMenuItem disabled={containerDisabled} onSelect={() => onAction("start")}>
                <PlayIcon aria-hidden />
                Iniciar
              </DropdownMenuItem>
              <DropdownMenuItem disabled={containerDisabled} onSelect={() => onAction("restart")}>
                <RotateCwIcon aria-hidden />
                Reiniciar
              </DropdownMenuItem>
              <DropdownMenuItem disabled={containerDisabled} onSelect={() => setConfirming("stop")}>
                <SquareIcon aria-hidden />
                Parar
              </DropdownMenuItem>
            </>
          ) : null}
          {canRedeploy ? (
            <DropdownMenuItem disabled={busy} onSelect={() => setConfirming("redeploy")}>
              <RefreshCwIcon aria-hidden />
              Redeploy
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirming === "stop"}
        onOpenChange={(open) => setConfirming(open ? "stop" : null)}
        title="Parar a aplicação?"
        description={stopDescription}
        confirmLabel="Parar"
        destructive
        onConfirm={() => onAction("stop")}
      />
      <ConfirmDialog
        open={confirming === "redeploy"}
        onOpenChange={(open) => setConfirming(open ? "redeploy" : null)}
        title="Recriar o contêiner?"
        description={redeployDescription}
        confirmLabel="Fazer redeploy"
        onConfirm={onRedeploy}
      />
    </div>
  );
}
