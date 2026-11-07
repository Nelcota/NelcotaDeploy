import {
  DatabaseBackupInProgressError,
  DatabaseBackupNotFoundError,
  DatabaseBackupUnsupportedError,
  DatabaseBeingDeletedError,
  DatabaseLimitError,
  DatabaseNotFoundError,
  DatabaseNotRunningError,
  DatabaseVariableConflictError,
  DatabaseServerChangedError,
  ProjectHasDatabasesError,
} from "@/databases";
import {
  DeploymentNotFoundError,
  InvalidDeploymentTransitionError,
  NoActiveContainerError,
  PreviewNotActiveError,
  ProjectNotApprovedError,
  RetryUnavailableError,
  RollbackUnavailableError,
} from "@/deployments";
import { type DnsConfigurationError, DomainNotFoundError, DomainTakenError } from "@/domains";
import { EnvironmentImportConflictError, EnvironmentVariableNotFoundError } from "@/environments";
import { ProjectNotFoundError, ProjectSlugTakenError } from "@/projects";
import {
  InvalidScheduleError,
  TaskNameTakenError,
  TaskNotFoundError,
  TaskRunningError,
  TaskReviewChangedError,
} from "@/tasks";
import {
  ProjectHasVolumesError,
  VolumeAttachedError,
  VolumeBeingDeletedError,
  VolumeLimitError,
  VolumeNotFoundError,
  VolumePathOverlapError,
  VolumeServerChangedError,
} from "@/volumes";

export const DNS_CONFIGURATION_MESSAGES: Record<DnsConfigurationError["reason"], string> = {
  "origin-not-found":
    "Não foi possível identificar uma origem única para o painel. Permita a leitura da zona do endereço do painel no token da Cloudflare ou use um servidor com IP público conhecido.",
  "not-connected": "Conecte a Cloudflare em Organização antes de configurar DNS.",
  "zone-not-found":
    "Nenhuma zona ativa autorizada cobre este domínio. Confira os domínios permitidos no token da Cloudflare.",
  "no-public-address": "Não foi possível detectar um IP público válido para o servidor do projeto.",
  "unsupported-record":
    "Este domínio não pertence ao projeto ou possui delegação NS que exige revisão manual.",
  "review-changed":
    "Os registros, a conexão ou o servidor mudaram. Verifique novamente e revise as novas alterações.",
  "invalid-review":
    "Esta revisão de DNS expirou ou é inválida. Prepare uma nova revisão antes de confirmar.",
  "too-many-records":
    "A configuração excede o limite seguro de registros ou zonas para uma única operação.",
};

/**
 * Portuguese messages for errors of projects, deployments, domains, variables, tasks, volumes
 * and databases.
 */
export const PROJECT_ERROR_MESSAGES: readonly (readonly [
  abstract new (...args: never[]) => Error,
  string,
])[] = [
  [
    TaskReviewChangedError,
    "A task mudou durante a revisão. Atualize a lista e confira o comando e o agendamento antes de confirmar novamente.",
  ],
  [
    VolumeServerChangedError,
    "O servidor do projeto mudou. Volte e revise o volume no servidor atual.",
  ],
  [
    DatabaseServerChangedError,
    "O servidor do projeto mudou. Volte e revise a criação do banco no servidor atual.",
  ],
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
  [DatabaseNotFoundError, "Banco de dados não encontrado."],
  [DatabaseLimitError, "Cada projeto pode ter no máximo 5 bancos de dados."],
  [
    DatabaseVariableConflictError,
    "O projeto já tem uma variável com esse nome. Escolha outro nome ou remova a variável.",
  ],
  [DatabaseBeingDeletedError, "Este banco de dados já está sendo excluído."],
  [DatabaseBackupUnsupportedError, "Backups estão disponíveis só para bancos PostgreSQL."],
  [
    DatabaseNotRunningError,
    "O banco precisa estar ativo. Aguarde ele iniciar ou terminar a restauração em andamento.",
  ],
  [DatabaseBackupInProgressError, "Já há um backup deste banco em andamento."],
  [DatabaseBackupNotFoundError, "Backup não encontrado ou ainda não concluído."],
  [
    ProjectHasDatabasesError,
    "Projetos com bancos de dados não podem mudar de servidor: os dados ficam no servidor atual.",
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
  [
    EnvironmentImportConflictError,
    "As variáveis mudaram durante a revisão. Confira a lista atualizada e importe novamente.",
  ],
  [TaskNotFoundError, "Task não encontrada."],
  [TaskRunningError, "Aguarde a execução da task terminar antes de excluí-la."],
  [TaskNameTakenError, "Já existe uma task com este nome neste projeto."],
  [InvalidScheduleError, "Expressão cron inválida. Use 5 campos, como */5 * * * *."],
];
