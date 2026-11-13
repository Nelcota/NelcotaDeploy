import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { NelcotaMark } from "@/web/components/shell/brand-logo";
import { MAIN_GROUPS } from "@/web/components/shell/navigation";
import { AccountMenu } from "@/web/components/shell/sidebar/account/account-menu";
import { SidebarAreas } from "@/web/components/shell/sidebar/sidebar-link";
import { SidebarProjects } from "@/web/components/shell/sidebar/sidebar-projects";
import type { SidebarState } from "@/web/components/shell/sidebar/use-sidebar-preferences";
import { cn } from "@/web/components/ui/class-names";
import type { SessionUser } from "@/web/functions/session.functions";

function Brand({
  collapsed,
  onNavigate,
}: {
  readonly collapsed: boolean;
  readonly onNavigate: () => void;
}) {
  return (
    <Link
      to="/"
      activeOptions={{ exact: true }}
      aria-label="Nelcota Deploy — Painel"
      onClick={onNavigate}
      className="flex min-w-0 items-center gap-1.5 rounded-lg px-0.5 py-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <NelcotaMark aria-hidden className="h-5 w-auto shrink-0" />
      <span className={collapsed ? "sr-only" : "truncate text-sm font-bold tracking-tight"}>
        Nelcota Deploy
      </span>
    </Link>
  );
}

type SidebarContentProps = {
  readonly sidebar: SidebarState;
  readonly user: SessionUser;
  readonly collapsed?: boolean;
  readonly actions: ReactNode;
  readonly navigationId?: string;
  readonly onNavigate: () => void;
};

export function SidebarContent({
  sidebar,
  user,
  collapsed = false,
  actions,
  navigationId,
  onNavigate,
}: SidebarContentProps) {
  return (
    <div className="flex h-full w-full flex-col py-2.5">
      <header
        className={cn(
          "flex shrink-0 items-center justify-between gap-1 px-2",
          collapsed ? "flex-col" : "min-h-10",
        )}
      >
        <Brand collapsed={collapsed} onNavigate={onNavigate} />
        {actions}
      </header>
      <nav
        id={navigationId}
        aria-label="Principal"
        className={cn(
          "mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-2 lg:mt-6",
          collapsed ? "space-y-1.5" : "space-y-2",
        )}
      >
        {MAIN_GROUPS.map((group) => (
          <SidebarAreas
            key={group.id}
            group={group.id}
            sidebar={sidebar}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
        <SidebarProjects sidebar={sidebar} collapsed={collapsed} onNavigate={onNavigate} />
        <SidebarAreas
          group="account"
          sidebar={sidebar}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      </nav>
      <footer className="shrink-0 border-t border-sidebar-border px-2 pt-2">
        <AccountMenu user={user} collapsed={collapsed} />
      </footer>
    </div>
  );
}
