import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { MAIN_AREAS, MAIN_GROUPS } from "@/web/components/shell/navigation";
import { SidebarGroup } from "@/web/components/shell/sidebar/sidebar-group";
import { useProjectList, useSystemStatus } from "@/web/components/shell/use-shell-queries";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";

type MainArea = (typeof MAIN_AREAS)[number];

/** Gives compact navigation controls a label on hover and keyboard focus. */
export function SidebarHint({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function AreaLink({
  area,
  count = null,
  collapsed,
  onNavigate,
}: {
  readonly area: MainArea;
  readonly count?: number | null;
  readonly collapsed: boolean;
  readonly onNavigate: () => void;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const exact =
    area.id === "administration" && pathname.startsWith("/settings/servers") ? true : area.exact;
  return (
    <SidebarHint label={area.label}>
      <Link
        to={area.to}
        search={area.search}
        activeOptions={{ exact }}
        onClick={onNavigate}
        aria-label={area.label}
        className="group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-[0.95rem] text-muted-foreground transition-colors hover:bg-well hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[status=active]:bg-primary data-[status=active]:text-primary-foreground"
      >
        <area.icon aria-hidden className="size-[1.15rem] shrink-0" />
        <span className={collapsed ? "sr-only" : "min-w-0 break-words"}>{area.label}</span>
        {collapsed || count == null || count === 0 ? null : (
          <span className="ml-auto min-w-6 rounded-md bg-well px-1.5 py-0.5 text-center text-xs font-medium text-muted-foreground tabular-nums group-data-[status=active]:bg-white/20 group-data-[status=active]:text-primary-foreground">
            {count}
          </span>
        )}
      </Link>
    </SidebarHint>
  );
}

export function SidebarAreas({
  group,
  collapsed,
  onNavigate,
}: {
  readonly group: MainArea["group"];
  readonly collapsed: boolean;
  readonly onNavigate: () => void;
}) {
  const projects = useProjectList();
  const status = useSystemStatus();
  const counts: Readonly<Record<string, number | null>> = {
    "/projects": projects.data?.length ?? null,
    "/deployments": status.data?.activeDeployments ?? null,
  };
  return (
    <SidebarGroup
      label={MAIN_GROUPS.find((item) => item.id === group)?.label ?? "Sistema"}
      collapsed={collapsed}
    >
      {MAIN_AREAS.filter((area) => area.group === group).map((area) => (
        <AreaLink
          key={area.id}
          area={area}
          count={counts[area.to] ?? null}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      ))}
    </SidebarGroup>
  );
}
