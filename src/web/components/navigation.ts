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

/** Top-level areas of the panel. */
export const MAIN_AREAS = [
  { to: "/", label: "Painel", icon: HomeIcon, exact: true },
  { to: "/projects", label: "Projetos", icon: BoxesIcon, exact: false },
  { to: "/deployments", label: "Deploys", icon: RocketIcon, exact: false },
  { to: "/settings", label: "Administração", icon: ShieldCheckIcon, exact: false },
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
  readonly tab: "organization" | "users" | "server" | "tokens" | "audit";
  readonly label: string;
  readonly icon: LucideIcon;
  readonly permission?: Permission;
}[] = [
  { tab: "organization", label: "Organização", icon: Building2Icon },
  { tab: "users", label: "Usuários", icon: UsersIcon, permission: "user:manage" },
  { tab: "server", label: "Servidor", icon: ServerIcon },
  { tab: "tokens", label: "Tokens de API", icon: KeyRoundIcon, permission: "token:manage" },
  { tab: "audit", label: "Auditoria", icon: ShieldIcon, permission: "audit:read" },
];

/** Where a breadcrumb leads; the last crumb of a trail has no link. */
type BreadcrumbLink =
  | { readonly to: "/" | "/projects" }
  | {
      readonly to: "/projects/$projectId" | "/projects/$projectId/deployments";
      readonly params: { readonly projectId: string };
    };

/** One step of the trail shown in the top bar. */
export type Breadcrumb = { readonly label: string; readonly link?: BreadcrumbLink };

const HOME_LABEL = "Painel";
const PROJECTS_LABEL = "Projetos";

/**
 * Returns the id of the project a path belongs to.
 *
 * @param pathname - Path of the current page, such as `/projects/abc/logs`.
 * @returns The project id, or null outside project pages.
 */
export function projectIdFromPath(pathname: string): string | null {
  const [area, projectId] = pathname.split("/").filter((segment) => segment !== "");
  if (area !== "projects" || projectId == null || projectId === "new") {
    return null;
  }
  return projectId;
}

function projectTrail(
  segments: readonly string[],
  projectName: string | null,
): readonly Breadcrumb[] {
  const home: Breadcrumb = { label: HOME_LABEL, link: { to: "/" } };
  const [, projectId, section, deploymentId] = segments;
  if (projectId == null) {
    return [home, { label: PROJECTS_LABEL }];
  }
  const projects: Breadcrumb = { label: PROJECTS_LABEL, link: { to: "/projects" } };
  if (projectId === "new") {
    return [home, projects, { label: "Novo projeto" }];
  }
  const projectLabel = projectName ?? "Projeto";
  if (section == null) {
    return [home, projects, { label: projectLabel }];
  }
  const params = { projectId };
  const project: Breadcrumb = { label: projectLabel, link: { to: "/projects/$projectId", params } };
  if (section === "deployments" && deploymentId != null) {
    const deployments: Breadcrumb = {
      label: "Deploys",
      link: { to: "/projects/$projectId/deployments", params },
    };
    return [home, projects, project, deployments, { label: "Deploy" }];
  }
  const sectionLabel =
    PROJECT_SECTIONS.find((item) => item.to.endsWith(`/${section}`))?.label ?? section;
  return [home, projects, project, { label: sectionLabel }];
}

/**
 * Builds the breadcrumb trail of a page from its path.
 *
 * @param pathname - Path of the current page.
 * @param projectName - Name of the project on project pages, or null while it loads.
 * @returns Crumbs from the dashboard to the current page; only the last one has no link.
 *
 * @example
 * breadcrumbTrail("/projects/abc/logs", "Loja");
 * // Painel › Projetos › Loja › Logs
 */
export function breadcrumbTrail(
  pathname: string,
  projectName: string | null,
): readonly Breadcrumb[] {
  const segments = pathname.split("/").filter((segment) => segment !== "");
  const [area] = segments;
  if (area == null) {
    return [{ label: HOME_LABEL }];
  }
  if (area === "projects") {
    return projectTrail(segments, projectName);
  }
  const areaLabel = MAIN_AREAS.find((item) => item.to === `/${area}`)?.label ?? area;
  return [{ label: HOME_LABEL, link: { to: "/" } }, { label: areaLabel }];
}
