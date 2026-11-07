import { Link } from "@tanstack/react-router";

import { CONTAINER_STATE_LABELS } from "@/web/components/layout/labels";
import { containerAccent, type RowAccent } from "@/web/components/projects/project-accent";
import { SidebarHint } from "@/web/components/shell/sidebar/sidebar-link";
import type { useProjectList } from "@/web/components/shell/use-shell-queries";
import { cn } from "@/web/components/ui/class-names";

const ACCENT_DOTS: Record<RowAccent, string> = {
  none: "bg-faint",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  progress: "bg-brand",
  neutral: "bg-faint",
};

export type SidebarProject = NonNullable<ReturnType<typeof useProjectList>["data"]>[number];

export function SidebarProjectLink({
  project,
  collapsed,
  onNavigate,
}: {
  readonly project: SidebarProject;
  readonly collapsed: boolean;
  readonly onNavigate: () => void;
}) {
  const state = project.containerState;
  const stateLabel = state == null ? "sem contêiner" : (CONTAINER_STATE_LABELS[state] ?? state);
  return (
    <SidebarHint label={`${project.name} · ${stateLabel}`}>
      <Link
        to="/projects/$projectId"
        params={{ projectId: project.id }}
        onClick={onNavigate}
        aria-label={`${project.name}, ${stateLabel}`}
        className="relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:bg-well hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[status=active]:bg-well data-[status=active]:text-foreground"
      >
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            collapsed ? "absolute right-1 bottom-1" : "",
            ACCENT_DOTS[containerAccent(project.containerState, project.containerHealth)],
          )}
        />
        <span aria-hidden className="truncate">
          {collapsed ? project.name.slice(0, 1).toLocaleUpperCase("pt-BR") : project.name}
        </span>
      </Link>
    </SidebarHint>
  );
}
