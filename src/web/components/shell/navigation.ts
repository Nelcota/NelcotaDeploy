import {
  ActivityIcon,
  BarChart3Icon,
  ClockIcon,
  DatabaseIcon,
  GlobeIcon,
  GitPullRequestIcon,
  HistoryIcon,
  ScrollTextIcon,
  ServerIcon,
  SettingsIcon,
  TerminalIcon,
  VariableIcon,
} from "lucide-react";

import {
  AdministrationIcon,
  DeploysIcon,
  OverviewIcon,
  ProjectsIcon,
} from "@/web/components/shell/navigation.icons";

export {
  SETTINGS_SECTIONS,
  legacyAdministrationDestination,
} from "./navigation/administration-destinations";

export const MAIN_GROUPS = [
  { id: "general", label: "Geral" },
  { id: "deployments", label: "Deploys" },
  { id: "infrastructure", label: "Infraestrutura" },
] as const;

/** Top-level areas of the panel; `group` places each one in the sidebar. */
export const MAIN_AREAS = [
  {
    to: "/",
    id: "dashboard",
    label: "Status das aplicações",
    icon: OverviewIcon,
    exact: true,
    group: "general",
    search: {},
  },
  {
    to: "/projects",
    id: "projects",
    label: "Projetos",
    icon: ProjectsIcon,
    exact: false,
    group: "general",
    search: {},
  },
  {
    to: "/deployments",
    id: "deployments",
    label: "Histórico de deploys",
    icon: DeploysIcon,
    exact: false,
    group: "deployments",
    search: {},
  },
  {
    to: "/activity",
    id: "activity",
    label: "Deploys recentes",
    icon: HistoryIcon,
    exact: true,
    group: "deployments",
    search: {},
  },
  {
    to: "/deployment-statistics",
    id: "deployment-statistics",
    label: "Estatísticas de deploys",
    icon: BarChart3Icon,
    exact: true,
    group: "deployments",
    search: {},
  },
  {
    to: "/settings/servers",
    label: "Servidores de deploy",
    id: "servers",
    icon: ServerIcon,
    exact: false,
    group: "infrastructure",
    search: {},
  },
  {
    to: "/server-metrics",
    id: "server-metrics",
    label: "Uso de recursos dos servidores",
    icon: ActivityIcon,
    exact: true,
    group: "infrastructure",
    search: {},
  },
  {
    to: "/settings",
    label: "Administração",
    id: "administration",
    icon: AdministrationIcon,
    exact: false,
    group: "account",
    search: {},
  },
] as const;

/** Project destinations, grouped by purpose in the header and shared with command search. */
export const PROJECT_SECTIONS = [
  {
    to: "/projects/$projectId",
    group: "Aplicação",
    label: "Status da aplicação",
    icon: OverviewIcon,
    exact: true,
  },
  {
    to: "/projects/$projectId/deployments",
    group: "Publicação",
    label: "Histórico de deploys",
    icon: DeploysIcon,
    exact: false,
  },
  {
    to: "/projects/$projectId/previews",
    group: "Publicação",
    label: "Ambientes de teste por pull request",
    icon: GitPullRequestIcon,
    exact: true,
  },
  {
    to: "/projects/$projectId/logs",
    group: "Aplicação",
    label: "Logs da aplicação",
    icon: ScrollTextIcon,
    exact: false,
  },
  {
    to: "/projects/$projectId/metrics",
    group: "Aplicação",
    label: "Uso de recursos da aplicação",
    icon: ActivityIcon,
    exact: false,
  },
  {
    to: "/projects/$projectId/environment",
    group: "Configuração",
    label: "Variáveis de ambiente",
    icon: VariableIcon,
    exact: false,
  },
  {
    to: "/projects/$projectId/domains",
    group: "Configuração",
    label: "Domínios da aplicação",
    icon: GlobeIcon,
    exact: false,
  },
  {
    to: "/projects/$projectId/dns",
    group: "Configuração",
    label: "Registros DNS dos domínios",
    icon: GlobeIcon,
    exact: true,
  },
  {
    to: "/projects/$projectId/databases",
    group: "Dados e tarefas",
    label: "Bancos de dados",
    icon: DatabaseIcon,
    exact: false,
  },
  {
    to: "/projects/$projectId/tasks",
    group: "Dados e tarefas",
    label: "Tarefas da aplicação",
    icon: ClockIcon,
    exact: false,
  },
  {
    to: "/projects/$projectId/settings",
    group: "Configuração",
    label: "Configurações do projeto",
    icon: SettingsIcon,
    exact: false,
  },
  {
    to: "/projects/$projectId/console",
    group: "Dados e tarefas",
    label: "Console da aplicação",
    icon: TerminalIcon,
    exact: false,
  },
] as const;
