import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { BoxesIcon, PlusIcon } from "lucide-react";
import { useMemo } from "react";

import { projectQueryOptions } from "@/web/components/projects/project-query";
import {
  type Command,
  filterCommands,
} from "@/web/components/shell/command-palette/command-search";
import { MAIN_AREAS, SETTINGS_SECTIONS } from "@/web/components/shell/navigation";
import { listProjectsFn } from "@/web/functions/projects.functions";

import { createProjectCommands } from "./project-commands";

type Navigate = ReturnType<typeof useNavigate>;

const PAGE_TERMS: Readonly<Record<string, string>> = {
  "/": "status estado saúde aplicações apps",
  "/activity": "falhas recentes atividade deploys",
  "/deployment-statistics": "gráficos análise sucesso falhas deploys",
  "/server-metrics": "métricas cpu memória servidor consumo recursos",
  "/settings/audit": "auditoria alterações usuários segurança",
};

function pageCommands(navigate: Navigate, permissions: readonly string[]): Command[] {
  const areas = MAIN_AREAS.map((item) => ({
    id: `page-${item.id}`,
    group: "Páginas" as const,
    label: item.label,
    hint: null,
    icon: item.icon,
    keywords: PAGE_TERMS[item.to] ?? "",
    run: async () => await navigate({ to: item.to, search: item.search }),
  }));
  const newProject = {
    id: "page-new-project",
    group: "Páginas" as const,
    label: "Novo projeto",
    hint: null,
    icon: PlusIcon,
    run: async () => await navigate({ to: "/projects/new" }),
  };
  const settings = SETTINGS_SECTIONS.filter(
    (section) =>
      section.tab !== "servers" &&
      (section.permission == null || permissions.includes(section.permission)),
  ).map((section) => ({
    id: `settings-${section.tab}`,
    group: "Administração" as const,
    label: section.label,
    hint: null,
    icon: section.icon,
    keywords: PAGE_TERMS[section.to] ?? "",
    run: async () => await navigate({ to: section.to }),
  }));
  const canCreateProject = permissions.includes("project:write");
  return [...areas, ...(canCreateProject ? [newProject] : []), ...settings];
}

/**
 * Lists matching destinations in the active project, followed by projects and global pages.
 *
 * @param options - Whether the palette is open (projects load only then), the user's
 *   permissions and the typed query.
 * @returns The matching commands, in display order.
 */
export function useCommands({
  open,
  permissions,
  query,
}: {
  readonly open: boolean;
  readonly permissions: readonly string[];
  readonly query: string;
}): Command[] {
  const navigate = useNavigate();
  const { projectId, deploymentId, databaseId, taskId } = useParams({ strict: false });
  const project = useQuery({
    ...projectQueryOptions(projectId ?? ""),
    enabled: open && projectId != null,
  });
  const projects = useQuery({
    queryKey: ["projects", ""],
    queryFn: () => listProjectsFn({ data: { search: "" } }),
    enabled: open,
  });

  return useMemo(() => {
    const projectCommands: Command[] = (projects.data ?? []).map((project) => ({
      id: `project-${project.id}`,
      group: "Projetos",
      label: project.name,
      hint: project.repositoryFullName,
      icon: BoxesIcon,
      run: async () =>
        await navigate({ to: "/projects/$projectId", params: { projectId: project.id } }),
    }));
    const destinations = createProjectCommands({
      navigate,
      permissions: projectId == null ? permissions : (project.data?.permissions ?? []),
      context: { projectId, deploymentId, databaseId, taskId },
      projectName: projects.data?.find((project) => project.id === projectId)?.name,
    });
    return filterCommands(
      [...destinations, ...projectCommands, ...pageCommands(navigate, permissions)],
      query,
    );
  }, [
    project.data?.permissions,
    projects.data,
    navigate,
    permissions,
    query,
    projectId,
    deploymentId,
    databaseId,
    taskId,
  ]);
}
