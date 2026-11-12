import { PinnedProjectPicker } from "@/web/components/shell/sidebar/pinned-project-picker";
import { SidebarGroup } from "@/web/components/shell/sidebar/sidebar-group";
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
    <p className={collapsed ? "sr-only" : "px-2.5 py-1.5 text-xs text-faint"}>{message}</p>
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

/** Shows up to four user-selected project shortcuts. */
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
      group="pinned"
      label="Fixados"
      collapsed={collapsed}
      sidebar={sidebar}
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
        <Skeleton className="h-10 rounded-lg" aria-label="Carregando projetos" />
      ) : null}
      <ProjectsNotice message={message} collapsed={collapsed} />
      <PinnedProjects
        projects={list}
        pinnedIds={pinnedIds}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
    </SidebarGroup>
  );
}
