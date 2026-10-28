import type { DeploymentStatus, DeploymentTrigger } from "@/deployments";
import type { Role } from "@/shared/roles";

export const DEPLOYMENT_STATUS_LABELS: Record<DeploymentStatus, string> = {
  queued: "Na fila",
  cloning: "Clonando",
  building: "Construindo",
  starting: "Iniciando",
  health_checking: "Verificando saúde",
  succeeded: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
};

export const DEPLOYMENT_TRIGGER_LABELS: Record<DeploymentTrigger, string> = {
  manual: "Manual",
  webhook: "Push no GitHub",
  redeploy: "Redeploy",
  rollback: "Rollback",
  mcp: "MCP",
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  developer: "Desenvolvedor",
  viewer: "Leitor",
};

export const CONTAINER_STATE_LABELS: Record<string, string> = {
  running: "Online",
  exited: "Parado",
  created: "Criado",
  restarting: "Reiniciando",
  paused: "Pausado",
  dead: "Com falha",
  removing: "Removendo",
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  queued: "Na fila",
  running: "Executando",
  succeeded: "Sucesso",
  failed: "Falhou",
};

/** Deployment statuses that are still in progress. */
export const ACTIVE_DEPLOYMENT_STATUSES: ReadonlySet<string> = new Set([
  "queued",
  "cloning",
  "building",
  "starting",
  "health_checking",
]);
