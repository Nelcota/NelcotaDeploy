import type { DeploymentFailureCause } from "@/deployments";
import type { ProjectDetails } from "@/web/components/projects/project-query";

import type { DeploymentDetailData } from "./use-deployment-detail";

const FAILURE_GUIDANCE = {
  repository_access: {
    text: "O GitHub recusou o acesso ou não encontrou o repositório.",
    section: "repository",
    action: "Revisar acesso ao repositório",
  },
  branch_not_found: {
    text: "A branch usada neste deploy não foi encontrada no repositório.",
    section: "repository",
    action: "Revisar repositório e branch",
  },
  build_path: {
    text: "Um caminho configurado para o build não pôde ser usado no repositório.",
    section: "build",
    action: "Revisar caminhos do build",
  },
  compose_configuration: {
    text: "A configuração do Docker Compose foi rejeitada.",
    section: "build",
    action: "Revisar configuração do Compose",
  },
  health_port: {
    text: "A aplicação não respondeu na porta interna durante a verificação.",
    section: "runtime",
    action: "Revisar porta interna",
  },
  health_endpoint: {
    text: "A verificação HTTP não recebeu uma resposta saudável a tempo.",
    section: "runtime",
    action: "Revisar porta e verificação de saúde",
  },
  docker_healthcheck: {
    text: "O HEALTHCHECK definido na imagem não passou. Veja os logs e revise o HEALTHCHECK no código.",
    section: null,
  },
  server_unavailable: {
    text: "O servidor escolhido para este deploy não está mais cadastrado.",
    section: "server",
    action: "Revisar servidor do projeto",
  },
} as const satisfies Record<
  DeploymentFailureCause,
  | { readonly text: string; readonly section: null }
  | {
      readonly text: string;
      readonly section: "repository" | "build" | "runtime" | "server";
      readonly action: string;
    }
>;

/** A diagnosis and action exist only for a cause recorded by the worker. */
export function deploymentFailureGuidance(cause: DeploymentFailureCause | null) {
  if (cause == null || Object.hasOwn(FAILURE_GUIDANCE, cause) === false) {
    return null;
  }

  return FAILURE_GUIDANCE[cause];
}

/** Describes the version currently assigned to this environment and its last known health. */
export function deploymentFailureAvailability(
  deployment: Pick<DeploymentDetailData, "id" | "previewId" | "previewDeploymentId" | "createdAt">,
  details:
    | {
        readonly project: Pick<ProjectDetails["project"], "currentDeploymentId">;
        readonly containers: readonly Pick<
          ProjectDetails["containers"][number],
          "deploymentId" | "state" | "health"
        >[];
        readonly worker: Pick<NonNullable<ProjectDetails["worker"]>, "online"> | null;
      }
    | undefined,
  currentVersionCreatedAt: string | null,
) {
  if (details == null) {
    return "O estado da versão publicada ainda não pôde ser confirmado.";
  }

  const currentId = currentDeploymentOf(deployment, details);
  if (currentId == null) {
    return "Nenhuma versão está publicada neste ambiente.";
  }

  const running = details.containers.some(
    (container) =>
      container.deploymentId === currentId &&
      container.state === "running" &&
      container.health !== "unhealthy" &&
      container.health !== "starting",
  );
  if (details.worker?.online !== true || running === false) {
    return "Há uma versão publicada, mas o painel ainda não confirma que ela esteja no ar.";
  }

  if (currentId === deployment.id) {
    return "O painel detectou um contêiner em execução para este deploy.";
  }

  if (currentVersionCreatedAt != null && currentVersionCreatedAt < deployment.createdAt) {
    return "A versão anterior continua no ar, segundo o monitoramento.";
  }

  return "Outra versão está no ar, segundo o monitoramento.";
}

/** Finds the version to compare with this failed deployment in the same environment. */
export function currentDeploymentOf(
  deployment: Pick<DeploymentDetailData, "previewId" | "previewDeploymentId">,
  details: { readonly project: Pick<ProjectDetails["project"], "currentDeploymentId"> } | undefined,
) {
  return deployment.previewId == null
    ? details?.project.currentDeploymentId
    : deployment.previewDeploymentId;
}
