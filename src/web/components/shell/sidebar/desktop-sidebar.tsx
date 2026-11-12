import { SidebarContent } from "@/web/components/shell/sidebar/sidebar";
import { SidebarHint } from "@/web/components/shell/sidebar/sidebar-link";
import type { SidebarState } from "@/web/components/shell/sidebar/use-sidebar-preferences";
import { Button } from "@/web/components/ui/button";
import { cn } from "@/web/components/ui/class-names";
import type { SessionUser } from "@/web/functions/session.functions";

const DESKTOP_NAVIGATION_ID = "desktop-sidebar";

function SidebarCollapseButton({ sidebar }: { readonly sidebar: SidebarState }) {
  const { collapsed } = sidebar.preferences;
  const label = collapsed ? "Expandir sidebar" : "Recolher sidebar";
  return (
    <SidebarHint label={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        aria-expanded={collapsed === false}
        aria-controls={DESKTOP_NAVIGATION_ID}
        className="size-7 rounded-md"
        onClick={() =>
          sidebar.updatePreferences({ ...sidebar.preferences, collapsed: collapsed === false })
        }
      >
        <span
          aria-hidden
          className={cn(
            "size-[1.125rem]",
            collapsed ? "solar-[panel-left-open-linear]" : "solar-[panel-left-close-linear]",
          )}
        />
      </Button>
    </SidebarHint>
  );
}

/** Desktop navigation can collapse without changing the mobile menu. */
export function DesktopSidebar({
  sidebar,
  user,
  onSearch,
}: {
  readonly sidebar: SidebarState;
  readonly user: SessionUser;
  readonly onSearch: () => void;
}) {
  const { collapsed } = sidebar.preferences;
  return (
    <aside
      aria-label="Menu lateral"
      className={cn(
        "hidden h-full shrink-0 bg-sidebar text-sidebar-foreground lg:flex",
        collapsed ? "w-16" : "w-56",
      )}
    >
      <SidebarContent
        sidebar={sidebar}
        user={user}
        collapsed={collapsed}
        navigationId={DESKTOP_NAVIGATION_ID}
        onNavigate={() => undefined}
        actions={
          <div className={cn("flex shrink-0 gap-0.5", collapsed && "flex-col")}>
            <SidebarHint label="Buscar projetos e páginas">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Buscar projetos e páginas"
                aria-keyshortcuts="Control+K Meta+K"
                className="size-7 rounded-md"
                onClick={onSearch}
              >
                <span aria-hidden className="solar-[magnifier-linear] size-[1.125rem]" />
              </Button>
            </SidebarHint>
            <SidebarCollapseButton sidebar={sidebar} />
          </div>
        }
      />
    </aside>
  );
}
