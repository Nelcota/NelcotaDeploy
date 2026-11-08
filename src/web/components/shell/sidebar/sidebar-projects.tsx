import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";

import { PinnedProjectPicker } from "@/web/components/shell/sidebar/pinned-project-picker";
import { SidebarGroup } from "@/web/components/shell/sidebar/sidebar-group";
import { SidebarHint } from "@/web/components/shell/sidebar/sidebar-link";
import { visiblePinnedProjectIds } from "@/web/components/shell/sidebar/sidebar-preferences";
import {
  SidebarProjectLink,
  type SidebarProject,
} from "@/web/components/shell/sidebar/sidebar-project-link";
import type { SidebarState } from "@/web/components/shell/sidebar/use-sidebar-preferences";
import { useProjectList } from "@/web/components/shell/use-shell-queries";
import { Skeleton } from "@/web/components/ui/skeleton";

function ProjectsNotice({
  message,
  collapsed,
}: {
  readonly message: string | null;
  readonly collapsed: boolean;
}) {
  return message == null ? null : (
    <p className={collapsed ? "sr-only" : "px-3 py-2 text-sm text-muted-foreground"}>{message}</p>
  );
}

function AllProjectsLink({
  collapsed,
  onNavigate,
}: {
  readonly collapsed: boolean;
  readonly onNavigate: () => void;
}) {
  return (
    <SidebarHint label="Ver todos os projetos">
      <Link
        to="/projects"
        onClick={onNavigate}
        aria-label="Ver todos os projetos"
        className="flex h-9 items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:bg-well hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {collapsed ? (
          <ArrowRightIcon aria-hidden className="size-4 shrink-0" />
        ) : (
          <span>Ver todos</span>
        )}
      </Link>
    </SidebarHint>
  );
}

function PinnedProjects({
  projects,
  pinnedIds,
  collapsed,
  onNavigate,
}: {
  readonly projects: readonly SidebarProject[];
  readonly pinnedIds: readonly string[];
  readonly collapsed: boolean;
  readonly onNavigate: () => void;
}) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  return pinnedIds.map((id) => {
    const project = projectById.get(id);
    return project == null ? null : (
      <SidebarProjectLink
        key={id}
        project={project}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
    );
  });
}

type SidebarProjectsProps = {
  readonly sidebar: SidebarState;
  readonly collapsed: boolean;
  readonly onNavigate: () => void;
};

/** Shows up to four user-selected projects and keeps the complete list one click away. */
export function SidebarProjects({ sidebar, collapsed, onNavigate }: SidebarProjectsProps) {
  const projects = useProjectList();
  const list = (projects.data ?? []).filter((project) => project.parentProjectId == null);

  const pinnedIds = visiblePinnedProjectIds(
    sidebar.preferences.pinnedProjectIds,
    list.map((project) => project.id),
  );
  const emptyLabel =
    list.length === 0 ? "Nenhum projeto ainda." : "Use o alfinete para fixar seus projetos.";
  const emptyMessage = projects.data != null && pinnedIds.length === 0 ? emptyLabel : null;
  const message =
    projects.isError && projects.data == null
      ? "Não foi possível carregar os projetos."
      : emptyMessage;
  return (
    <SidebarGroup
      label="Fixados"
      collapsed={collapsed}
      actions={
        <PinnedProjectPicker
          projects={list}
          sidebar={sidebar}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      }
    >
      {projects.isPending ? (
        <Skeleton className="h-10 rounded-xl" aria-label="Carregando projetos" />
      ) : null}
      <ProjectsNotice message={message} collapsed={collapsed} />
      <PinnedProjects
        projects={list}
        pinnedIds={pinnedIds}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
      <AllProjectsLink collapsed={collapsed} onNavigate={onNavigate} />
    </SidebarGroup>
  );
}
