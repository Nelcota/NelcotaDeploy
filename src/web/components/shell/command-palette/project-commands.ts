import type { useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  FileUpIcon,
  HistoryIcon,
  ListChecksIcon,
  ScrollTextIcon,
  SettingsIcon,
} from "lucide-react";

import { ENVIRONMENT_SECTIONS } from "@/web/components/environment/navigation/environment-destinations";
import { visibleSettingsSections } from "@/web/components/project-settings/navigation/settings-destinations";
import { PROJECT_SECTIONS } from "@/web/components/shell/navigation";

import type { Command } from "./command-search";

type ProjectCommandOptions = {
  readonly navigate: ReturnType<typeof useNavigate>;
  readonly permissions: readonly string[];
  readonly projectName?: string | undefined;
  readonly context: {
    readonly projectId?: string | undefined;
    readonly deploymentId?: string | undefined;
    readonly databaseId?: string | undefined;
    readonly taskId?: string | undefined;
  };
};

const PAGE_TERMS: Readonly<Record<string, string>> = {
  "/projects/$projectId/logs": "runtime execução saída",
  "/projects/$projectId/console": "terminal comandos execução console shell",
  "/projects/$projectId/metrics": "métricas cpu memória recursos consumo",
  "/projects/$projectId/previews": "previews pull request pr temporário",
  "/projects/$projectId/databases":
    "postgres postgresql mysql mongodb redis backups cópias restaurar restauração",
  "/projects/$projectId/tasks": "tasks tarefas agendamentos cron execuções histórico",
  "/projects/$projectId/dns": "cloudflare registros apontamento",
};

const SETTINGS_TERMS: Readonly<Record<string, string>> = {
  identity: "identidade nome identificador slug",
  repository: "github branch token credencial acesso",
  build: "build docker dockerfile imagem diretório contexto compilação",
  runtime: "execução runtime porta saúde healthcheck",
  automation: "automático webhook previews pull request",
  volumes: "volumes disco persistência pastas arquivos mount",
  server: "servidor mover transferência",
  team: "equipe membros acesso permissões gerente",
  staging: "ambientes produção staging promover",
  deletion: "excluir apagar remover exclusão",
};

/** Builds searchable links to the current project's pages while preserving each permission. */
export function createProjectCommands(options: ProjectCommandOptions): Command[] {
  const { projectId } = options.context;
  if (projectId == null || projectId.trim() === "") {
    return [];
  }
  const permissions = new Set(options.permissions);
  const hint =
    options.projectName == null || options.projectName.trim() === ""
      ? "Projeto atual"
      : options.projectName;
  const { navigate } = options;
  const pages: Command[] = PROJECT_SECTIONS.map((section) => ({
    id: `project-page-${section.to}`,
    group: "Neste projeto",
    label: section.label,
    hint: `${hint} · ${section.group}`,
    icon: section.icon,
    keywords: PAGE_TERMS[section.to] ?? "",
    run: async () => await navigate({ to: section.to, params: { projectId } }),
  }));
  const settings: Command[] = visibleSettingsSections((permission) =>
    permissions.has(permission),
  ).map((section) => ({
    id: `project-settings-${section.id}`,
    group: "Neste projeto",
    label: section.label,
    hint: `${hint} · Configurações do projeto`,
    icon: SettingsIcon,
    keywords: SETTINGS_TERMS[section.id] ?? "",
    run: async () => await navigate({ to: section.to, params: { projectId } }),
  }));
  const imports: Command[] = ENVIRONMENT_SECTIONS.filter(
    (section) => section.permission != null && permissions.has(section.permission),
  ).map((section) => ({
    id: `project-import-${section.to}`,
    group: "Neste projeto",
    label: section.label,
    hint: `${hint} · Variáveis de ambiente`,
    icon: FileUpIcon,
    keywords: "importar arquivo ambiente env example template modelo",
    run: async () => await navigate({ to: section.to, params: { projectId } }),
  }));
  return [...resourceCommands(options, { projectId, hint }), ...pages, ...settings, ...imports];
}

function resourceCommands(
  options: ProjectCommandOptions,
  project: { readonly projectId: string; readonly hint: string },
): Command[] {
  const { projectId, hint } = project;
  const { navigate } = options;
  const { deploymentId, databaseId, taskId } = options.context;
  const deployments: Command[] =
    deploymentId == null || deploymentId.trim() === ""
      ? []
      : [
          {
            id: "current-deployment-progress",
            group: "Neste projeto",
            label: "Progresso do deploy",
            hint,
            icon: ListChecksIcon,
            run: async () =>
              await navigate({
                to: "/projects/$projectId/deployments/$deploymentId",
                params: { projectId, deploymentId },
              }),
          },
          {
            id: "current-deployment-logs",
            group: "Neste projeto",
            label: "Logs da construção da imagem",
            hint,
            icon: ScrollTextIcon,
            keywords: "build construção compilação saída",
            run: async () =>
              await navigate({
                to: "/projects/$projectId/deployments/$deploymentId/logs",
                params: { projectId, deploymentId },
              }),
          },
        ];
  const backups: Command[] =
    databaseId == null || databaseId.trim() === ""
      ? []
      : [
          {
            id: "current-database-backups",
            group: "Neste projeto",
            label: "Backups do banco",
            hint,
            icon: ArchiveIcon,
            run: async () =>
              await navigate({
                to: "/projects/$projectId/databases/$databaseId/backups",
                params: { projectId, databaseId },
              }),
          },
        ];
  const restore: Command[] =
    databaseId == null ||
    databaseId.trim() === "" ||
    options.permissions.includes("project:delete") === false
      ? []
      : [
          {
            id: "current-database-restore",
            group: "Neste projeto",
            label: "Restaurar banco",
            hint,
            icon: ArchiveRestoreIcon,
            keywords: "restauração recuperar cópia",
            run: async () =>
              await navigate({
                to: "/projects/$projectId/databases/$databaseId/restore",
                params: { projectId, databaseId },
              }),
          },
        ];
  const history: Command[] =
    taskId == null || taskId.trim() === ""
      ? []
      : [
          {
            id: "current-task-history",
            group: "Neste projeto",
            label: "Histórico de execuções",
            hint,
            icon: HistoryIcon,
            keywords: "task tarefa resultados saída",
            run: async () =>
              await navigate({
                to: "/projects/$projectId/tasks/$taskId/history",
                params: { projectId, taskId },
              }),
          },
        ];
  return [...deployments, ...backups, ...restore, ...history];
}
