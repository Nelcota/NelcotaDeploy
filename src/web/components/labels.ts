import {
  BotIcon,
  HandIcon,
  type LucideIcon,
  RefreshCwIcon,
  Undo2Icon,
  WebhookIcon,
} from "lucide-react";

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

/** Icon shown beside each deploy origin, so the origin reads at a glance. */
export const DEPLOYMENT_TRIGGER_ICONS: Record<DeploymentTrigger, LucideIcon> = {
  manual: HandIcon,
  webhook: WebhookIcon,
  redeploy: RefreshCwIcon,
  rollback: Undo2Icon,
  mcp: BotIcon,
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

export const CONTAINER_HEALTH_LABELS: Record<string, string> = {
  healthy: "Saudável",
  unhealthy: "Falhando na verificação",
  starting: "Verificando saúde",
};

/** Reasons the GitHub webhook endpoint records for each delivery. */
export const WEBHOOK_REASON_LABELS: Record<string, string> = {
  ping: "Ping de teste do GitHub",
  processing: "Em processamento",
  "deployments queued": "Deploys colocados na fila",
  "payload is not valid JSON": "Conteúdo inválido (não é JSON)",
  "push payload is missing required fields": "Push sem os campos obrigatórios",
  "branch deletion": "Branch apagada",
  "not a branch push": "Push que não é de branch",
  "no approved project with auto-deploy for this repository and branch":
    "Nenhum projeto aprovado com deploy automático para este repositório e branch",
};

/** Audited actions, by their stored code. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "api_token.create": "Token de API criado",
  "api_token.revoke": "Token de API revogado",
  "container.start": "Contêiner iniciado",
  "container.stop": "Contêiner parado",
  "container.restart": "Contêiner reiniciado",
  "deployment.manual": "Deploy manual",
  "deployment.webhook": "Deploy por push no GitHub",
  "deployment.redeploy": "Redeploy",
  "deployment.rollback": "Rollback",
  "deployment.mcp": "Deploy via MCP",
  "deployment.cancel": "Deploy cancelado",
  "domain.add": "Domínio adicionado",
  "domain.remove": "Domínio removido",
  "environment_variable.create": "Variável criada",
  "environment_variable.update": "Variável alterada",
  "environment_variable.delete": "Variável excluída",
  "project.approve": "Projeto aprovado",
  "project.create": "Projeto criado",
  "project.update": "Projeto alterado",
  "project.delete": "Projeto excluído",
  "task.create": "Task criada",
  "task.update": "Task alterada",
  "task.delete": "Task excluída",
  "task.run": "Task executada",
  "user.create": "Usuário criado",
  "user.disable": "Usuário desativado",
  "user.enable": "Usuário reativado",
  "user.password_reset": "Senha redefinida",
  "user.role_update": "Papel alterado",
};
