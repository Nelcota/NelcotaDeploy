import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { BoxesIcon, PlusIcon } from "lucide-react";
import { useMemo } from "react";

import {
  type Command,
  filterCommands,
} from "@/web/components/shell/command-palette/command-search";
import { MAIN_AREAS, SETTINGS_SECTIONS } from "@/web/components/shell/navigation";
import { listProjectsFn } from "@/web/functions/projects.functions";

type Navigate = ReturnType<typeof useNavigate>;

function pageCommands(navigate: Navigate, permissions: readonly string[]): Command[] {
  const areas = MAIN_AREAS.map((item) => ({
    id: `page-${item.to}`,
    group: "Páginas" as const,
    label: item.label,
    hint: "Página",
    icon: item.icon,
    run: async () => await navigate({ to: item.to }),
  }));
  const newProject = {
    id: "page-new-project",
    group: "Páginas" as const,
    label: "Novo projeto",
    hint: "Criar projeto",
    icon: PlusIcon,
    run: async () => await navigate({ to: "/projects/new" }),
  };
  const settings = SETTINGS_SECTIONS.filter(
    (section) => section.permission == null || permissions.includes(section.permission),
  ).map((section) => ({
    id: `settings-${section.tab}`,
    group: "Páginas" as const,
    label: `Administração · ${section.label}`,
    hint: "Administração",
    icon: section.icon,
    run: async () => await navigate({ to: "/settings", search: { tab: section.tab } }),
  }));
  const canCreateProject = permissions.includes("project:write");
  return [...areas, ...(canCreateProject ? [newProject] : []), ...settings];
}

/**
 * Lists the palette commands matching the query: the projects first, then the pages the
 * user may open.
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
    return filterCommands([...projectCommands, ...pageCommands(navigate, permissions)], query);
  }, [projects.data, navigate, permissions, query]);
}
