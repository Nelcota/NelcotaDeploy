import { Link } from "@tanstack/react-router";

import { CONTAINER_STATE_LABELS } from "@/web/components/layout/labels";
import { containerAccent, type RowAccent } from "@/web/components/projects/project-accent";
import { SidebarGroup } from "@/web/components/shell/sidebar/sidebar-group";
import { useProjectList } from "@/web/components/shell/use-shell-queries";
import { cn } from "@/web/components/ui/class-names";
import { Skeleton } from "@/web/components/ui/skeleton";

/** Projects listed in the sidebar; the rest are one click away on the projects page. */
const SIDEBAR_PROJECT_LIMIT = 6;

const ACCENT_DOTS: Record<RowAccent, string> = {
  none: "bg-faint",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  progress: "bg-brand",
  neutral: "bg-faint",
};

type SidebarProject = NonNullable<ReturnType<typeof useProjectList>["data"]>[number];

function containerStateText(state: string | null): string {
  if (state == null) {
    return "sem contêiner";
  }
  return CONTAINER_STATE_LABELS[state] ?? state;
}

function SidebarProjectLink({
  project,
  onNavigate,
}: {
  readonly project: SidebarProject;
  readonly onNavigate: () => void;
}) {
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      onClick={onNavigate}
      className="flex h-10 items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:bg-well hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[status=active]:bg-well data-[status=active]:text-foreground"
    >
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          ACCENT_DOTS[containerAccent(project.containerState, project.containerHealth)],
        )}
      />
      <span className="truncate">{project.name}</span>
      <span className="sr-only">
        {", "}
        {containerStateText(project.containerState)}
      </span>
    </Link>
  );
}

function SidebarProjectsLoading() {
  return (
    <div className="space-y-1" aria-busy="true" aria-label="Carregando projetos">
      <Skeleton className="h-10 rounded-xl" />
      <Skeleton className="h-10 rounded-xl" />
      <Skeleton className="h-10 rounded-xl" />
    </div>
  );
}

/** The first projects with their container state, and a link to all of them. */
export function SidebarProjects({ onNavigate }: { readonly onNavigate: () => void }) {
  const projects = useProjectList();
  const list = projects.data ?? [];
  return (
    <SidebarGroup label="Projetos">
      {projects.isPending ? <SidebarProjectsLoading /> : null}
      {projects.isError && projects.data == null ? (
        <p className="px-3 text-sm text-muted-foreground">Não foi possível carregar os projetos.</p>
      ) : null}
      {projects.data != null && list.length === 0 ? (
        <p className="px-3 text-sm text-muted-foreground">Nenhum projeto ainda.</p>
      ) : null}
      {list.slice(0, SIDEBAR_PROJECT_LIMIT).map((project) => (
        <SidebarProjectLink key={project.id} project={project} onNavigate={onNavigate} />
      ))}
      {list.length > SIDEBAR_PROJECT_LIMIT ? (
        <Link
          to="/projects"
          onClick={onNavigate}
          className="flex h-9 items-center rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Ver todos ({list.length})
        </Link>
      ) : null}
    </SidebarGroup>
  );
}
