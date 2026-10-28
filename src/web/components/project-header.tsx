import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  GitBranchIcon,
  GitForkIcon,
  PlayIcon,
  RefreshCwIcon,
  RocketIcon,
  RotateCwIcon,
  SquareIcon,
} from "lucide-react";

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
            <h1 className="truncate text-3xl leading-tight font-semibold tracking-tight">
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
        className="2xl:w-[34rem] 2xl:shrink-0"
        metrics={[
          {
            label: "Contêiner",
            value: containerLabel(container),
            detail:
              container?.startedAt == null
                ? "nunca iniciado"
                : `desde ${formatRelativeTime(container.startedAt, now)}`,
          },
          {
            label: "Último deploy",
            value:
              latest.data == null
                ? "—"
                : formatShortTime(latest.data.finishedAt ?? latest.data.createdAt),
            detail:
              latest.data?.commitSha == null
                ? "sem deploy concluído"
                : `${formatRelativeTime(latest.data.finishedAt ?? latest.data.createdAt, now)} · ${latest.data.commitSha.slice(0, SHORT_SHA_LENGTH)}`,
          },
          {
            label: "Reinícios",
            value: container?.restartCount ?? 0,
            detail: `${details.domains.length} domínio(s)`,
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canDeploy ? (
        <Button size="sm" disabled={busy} onClick={() => deploy.mutate()}>
          <RocketIcon aria-hidden />
          Deploy
        </Button>
      ) : null}
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
    </div>
  );
}
