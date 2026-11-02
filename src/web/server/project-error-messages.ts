import { InvalidProjectMemberError, ProjectMemberNotFoundError } from "@/access";
import {
  ConsoleBusyError,
  ConsoleCommandNotFoundError,
  ConsoleUnavailableError,
  InvalidConsoleCommandError,
} from "@/console";
import {
  DatabaseBackupInProgressError,
  DatabaseBackupNotFoundError,
  DatabaseBackupUnsupportedError,
  DatabaseBeingDeletedError,
  DatabaseLimitError,
  DatabaseNotFoundError,
  DatabaseNotRunningError,
  DatabaseVariableConflictError,
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
import { DomainNotFoundError, DomainTakenError } from "@/domains";
import { EnvironmentVariableNotFoundError } from "@/environments";
import {
  ComposeNeedsNoVolumesError,
  ProjectNotFoundError,
  ProjectSlugTakenError,
  ReplicasNeedNoVolumesError,
} from "@/projects";
import {
  InvalidStagingBranchError,
  NotAProductionProjectError,
  NotAStagingEnvironmentError,
  NothingToPromoteError,
  PromotionRepositoryMismatchError,
  StagingAlreadyExistsError,
  StagingDeploymentChangedError,
} from "@/staging";
import {
  InvalidScheduleError,
  TaskNameTakenError,
  TaskNotFoundError,
  TaskRunningError,
} from "@/tasks";
import {
  ComposeProjectVolumeError,
  ProjectHasVolumesError,
  ReplicatedProjectVolumeError,
  VolumeAttachedError,
  VolumeBeingDeletedError,
  VolumeLimitError,
  VolumeNotFoundError,
  VolumePathOverlapError,
} from "@/volumes";

/**
 * Portuguese messages for errors of projects, members, the console, deployments, domains,
 * variables, tasks, volumes and databases.
 */
export const PROJECT_ERROR_MESSAGES: readonly (readonly [
  abstract new (...args: never[]) => Error,
  string,
])[] = [
  [ProjectNotFoundError, "Projeto não encontrado."],
  [InvalidConsoleCommandError, "Digite um comando de até 2.000 caracteres, em uma linha só."],
  [ConsoleBusyError, "Espere o comando anterior terminar antes de rodar outro."],
  [ConsoleUnavailableError, "Faça o primeiro deploy antes de usar o console."],
  [ConsoleCommandNotFoundError, "Comando não encontrado."],
  [
    InvalidProjectMemberError,
    "Não foi possível adicionar este usuário: ele já é membro, é administrador ou não existe.",
  ],
  [ProjectMemberNotFoundError, "Este usuário não é membro do projeto."],
  [
    ReplicasNeedNoVolumesError,
    "Projetos com volumes rodam só 1 réplica: várias réplicas gravando no mesmo volume corrompem os dados. Desanexe os volumes antes.",
  ],
  [
    ComposeNeedsNoVolumesError,
    "Projetos Docker Compose não usam os volumes do painel. Desanexe os volumes antes; os serviços guardam dados nos volumes do próprio arquivo Compose.",
  ],
  [
    ComposeProjectVolumeError,
    "Projetos Docker Compose guardam dados nos volumes do próprio arquivo Compose, não nos do painel.",
  ],
  [
    ReplicatedProjectVolumeError,
    "Projetos com mais de 1 réplica não podem montar volumes. Volte para 1 réplica antes.",
  ],
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
  [
    DatabaseBackupUnsupportedError,
    "Backups estão disponíveis para PostgreSQL, MySQL e MongoDB, mas não para Redis.",
  ],
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
  [
    StagingAlreadyExistsError,
    "Este projeto já tem um ambiente de staging (ou um ainda sendo excluído). Aguarde e tente de novo.",
  ],
  [NotAProductionProjectError, "O staging só pode ser criado a partir do projeto de produção."],
  [InvalidStagingBranchError, "Nome de branch inválido."],
  [NotAStagingEnvironmentError, "Só um ambiente de staging pode ser promovido para produção."],
  [NothingToPromoteError, "O staging ainda não tem um deploy no ar para promover."],
  [
    StagingDeploymentChangedError,
    "O deploy do staging mudou. Confira a nova versão e confirme a promoção novamente.",
  ],
  [
    PromotionRepositoryMismatchError,
    "O staging usa outro repositório que a produção; ajuste o repositório antes de promover.",
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
  [TaskRunningError, "Aguarde a execução da task terminar antes de excluí-la."],
  [TaskNameTakenError, "Já existe uma task com este nome neste projeto."],
  [InvalidScheduleError, "Expressão cron inválida. Use 5 campos, como */5 * * * *."],
];
