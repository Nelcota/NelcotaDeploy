import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { MAIN_AREAS, MAIN_GROUPS } from "@/web/components/shell/navigation";
import { SidebarGroup } from "@/web/components/shell/sidebar/sidebar-group";
import type { SidebarState } from "@/web/components/shell/sidebar/use-sidebar-preferences";
import { useProjectList, useSystemStatus } from "@/web/components/shell/use-shell-queries";
import { cn } from "@/web/components/ui/class-names";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";

type MainArea = (typeof MAIN_AREAS)[number];

const SIDEBAR_AREAS: Record<MainArea["id"], { readonly label: string; readonly icon: string }> = {
  dashboard: { label: "Visão geral", icon: "solar-[home-2-bold-duotone]" },
  projects: { label: "Projetos", icon: "solar-[folder-2-bold-duotone]" },
  deployments: { label: "Histórico", icon: "solar-[rocket-2-bold-duotone]" },
  activity: { label: "Recentes", icon: "solar-[history-bold-duotone]" },
  "deployment-statistics": { label: "Estatísticas", icon: "solar-[chart-2-bold-duotone]" },
  servers: { label: "Servidores", icon: "solar-[server-bold-duotone]" },
  "server-metrics": { label: "Métricas", icon: "solar-[pulse-2-bold-duotone]" },
  administration: { label: "Administração", icon: "solar-[settings-bold-duotone]" },
};

export const sidebarLinkClass =
  "flex min-h-9 items-center gap-2 rounded-lg border border-transparent px-2.5 py-1 text-sm leading-5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none aria-[current=page]:border-sidebar-border aria-[current=page]:bg-surface-raised aria-[current=page]:font-semibold aria-[current=page]:text-sidebar-foreground aria-[current=page]:shadow-xs forced-colors:aria-[current=page]:border-[Highlight]";

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
  const { label, icon } = SIDEBAR_AREAS[area.id];
  return (
    <SidebarHint label={area.label}>
      <Link
        to={area.to}
        search={area.search}
        activeOptions={{ exact }}
        onClick={onNavigate}
        className={cn(sidebarLinkClass, collapsed && "justify-center px-0")}
      >
        <span aria-hidden className={cn("size-4 shrink-0", icon)} />
        <span className={collapsed ? "sr-only" : "min-w-0 truncate"}>{label}</span>
        {collapsed || count == null || count === 0 ? null : (
          <span
            aria-hidden
            className="ml-auto shrink-0 text-xs font-medium text-faint tabular-nums"
          >
            {count}
          </span>
        )}
      </Link>
    </SidebarHint>
  );
}

export function SidebarAreas({
  group,
  sidebar,
  collapsed,
  onNavigate,
}: {
  readonly group: MainArea["group"];
  readonly sidebar: SidebarState;
  readonly collapsed: boolean;
  readonly onNavigate: () => void;
}) {
  const projects = useProjectList();
  const status = useSystemStatus();
  const counts: Readonly<Record<string, number | null>> = {
    "/projects": projects.data?.length ?? null,
    "/deployments": status.data?.activeDeployments ?? null,
  };
  const links = MAIN_AREAS.filter((area) => area.group === group).map((area) => (
    <AreaLink
      key={area.id}
      area={area}
      count={counts[area.to] ?? null}
      collapsed={collapsed}
      onNavigate={onNavigate}
    />
  ));
  if (group === "general" || group === "account") {
    return (
      <div className={group === "account" ? "border-t border-sidebar-border pt-1.5" : undefined}>
        {links}
      </div>
    );
  }

  const label = MAIN_GROUPS.find((item) => item.id === group)?.label ?? group;
  return (
    <SidebarGroup group={group} label={label} collapsed={collapsed} sidebar={sidebar}>
      {links}
    </SidebarGroup>
  );
}
