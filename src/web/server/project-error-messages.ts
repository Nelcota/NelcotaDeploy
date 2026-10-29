import {
  DeploymentNotFoundError,
  InvalidDeploymentTransitionError,
  NoActiveContainerError,
  PreviewNotActiveError,
  ProjectNotApprovedError,
  RetryUnavailableError,
  RollbackUnavailableError,
} from "@/deployments";
import { DomainNotFoundError, DomainTakenError } from "@/domains";
import { EnvironmentVariableNotFoundError } from "@/environments";
import { ProjectNotFoundError, ProjectSlugTakenError } from "@/projects";
import { InvalidScheduleError, TaskNameTakenError, TaskNotFoundError } from "@/tasks";
import {
  ProjectHasVolumesError,
  VolumeAttachedError,
  VolumeBeingDeletedError,
  VolumeLimitError,
  VolumeNotFoundError,
  VolumePathOverlapError,
} from "@/volumes";

/** Portuguese messages for errors of projects, deployments, domains, variables, tasks and volumes. */
export const PROJECT_ERROR_MESSAGES: readonly (readonly [
  abstract new (...args: never[]) => Error,
  string,
])[] = [
  [ProjectNotFoundError, "Projeto não encontrado."],
  [PreviewNotActiveError, "Este preview foi encerrado com o pull request."],
  [VolumeNotFoundError, "Volume não encontrado."],
  [VolumeLimitError, "Cada projeto pode ter no máximo 10 volumes."],
  [VolumePathOverlapError, "Esse caminho coincide com o de outro volume do projeto."],
  [VolumeAttachedError, "Desanexe o volume antes de apagar os dados."],
  [VolumeBeingDeletedError, "Os dados deste volume já estão sendo apagados."],
  [
    ProjectHasVolumesError,
    "Projetos com volumes não podem mudar de servidor: os dados ficam no servidor atual.",
  ],
  [ProjectSlugTakenError, "Já existe um projeto com este identificador."],
  [
    ProjectNotApprovedError,
    "Este projeto precisa ser aprovado por um administrador antes do primeiro deploy.",
  ],
  [
    RollbackUnavailableError,
    "Rollback indisponível: o deploy escolhido não tem uma imagem reutilizável.",
  ],
  [RetryUnavailableError, "Só é possível tentar de novo um deploy que falhou ou foi cancelado."],
  [NoActiveContainerError, "O projeto ainda não tem um contêiner implantado."],
  [DeploymentNotFoundError, "Deploy não encontrado."],
  [InvalidDeploymentTransitionError, "O deploy mudou de estado. Atualize a página."],
  [DomainTakenError, "Este domínio já está em uso por outro projeto."],
  [DomainNotFoundError, "Domínio não encontrado."],
  [EnvironmentVariableNotFoundError, "Variável não encontrada."],
  [TaskNotFoundError, "Task não encontrada."],
  [TaskNameTakenError, "Já existe uma task com este nome neste projeto."],
  [InvalidScheduleError, "Expressão cron inválida. Use 5 campos, como */5 * * * *."],
];
