import {
  ActivityIcon,
  BoxesIcon,
  Building2Icon,
  ClockIcon,
  GlobeIcon,
  HomeIcon,
  KeyRoundIcon,
  type LucideIcon,
  RocketIcon,
  ScrollTextIcon,
  ServerIcon,
  SettingsIcon,
  ShieldCheckIcon,
  ShieldIcon,
  UsersIcon,
  VariableIcon,
} from "lucide-react";

import type { Permission } from "@/shared/roles";

/** Top-level areas of the panel; `group` places each one in the sidebar. */
export const MAIN_AREAS = [
  { to: "/", label: "Painel", icon: HomeIcon, exact: true, group: "overview" },
  { to: "/projects", label: "Projetos", icon: BoxesIcon, exact: false, group: "overview" },
  { to: "/deployments", label: "Deploys", icon: RocketIcon, exact: false, group: "overview" },
  {
    to: "/settings",
    label: "Administração",
    icon: ShieldCheckIcon,
    exact: false,
    group: "account",
  },
] as const;

/** Pages of one project, shown as tabs under the project header. */
export const PROJECT_SECTIONS = [
  { to: "/projects/$projectId", label: "Visão geral", icon: HomeIcon, exact: true },
  { to: "/projects/$projectId/deployments", label: "Deploys", icon: RocketIcon, exact: false },
  { to: "/projects/$projectId/logs", label: "Logs", icon: ScrollTextIcon, exact: false },
  { to: "/projects/$projectId/metrics", label: "Métricas", icon: ActivityIcon, exact: false },
  { to: "/projects/$projectId/environment", label: "Variáveis", icon: VariableIcon, exact: false },
  { to: "/projects/$projectId/domains", label: "Domínios", icon: GlobeIcon, exact: false },
  { to: "/projects/$projectId/tasks", label: "Tasks", icon: ClockIcon, exact: false },
  { to: "/projects/$projectId/settings", label: "Ajustes", icon: SettingsIcon, exact: false },
] as const;

/** Sections of the settings page; each is a `?tab=` value. */
export const SETTINGS_SECTIONS: readonly {
  readonly tab: "organization" | "users" | "servers" | "server" | "tokens" | "audit";
  readonly label: string;
  readonly icon: LucideIcon;
  readonly permission?: Permission;
}[] = [
  { tab: "organization", label: "Organização", icon: Building2Icon },
  { tab: "users", label: "Usuários", icon: UsersIcon, permission: "user:manage" },
  { tab: "servers", label: "Servidores", icon: ServerIcon },
  { tab: "server", label: "Sistema", icon: ActivityIcon },
  { tab: "tokens", label: "Tokens de API", icon: KeyRoundIcon, permission: "token:manage" },
  { tab: "audit", label: "Auditoria", icon: ShieldIcon, permission: "audit:read" },
];
