import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";

import { SidebarContent } from "@/web/components/shell/sidebar/sidebar";
import { SidebarHint } from "@/web/components/shell/sidebar/sidebar-link";
import type { SidebarState } from "@/web/components/shell/sidebar/use-sidebar-preferences";
import { Button } from "@/web/components/ui/button";
import { cn } from "@/web/components/ui/class-names";

/** Desktop navigation can collapse without changing the mobile menu. */
export function DesktopSidebar({ sidebar }: { readonly sidebar: SidebarState }) {
  const { collapsed } = sidebar.preferences;
  const label = collapsed ? "Expandir sidebar" : "Recolher sidebar";
  return (
    <aside
      aria-label="Menu lateral"
      className={cn("hidden h-full shrink-0 flex-col lg:flex", collapsed ? "w-16" : "w-[17rem]")}
    >
      <div id="desktop-sidebar" className="min-h-0 flex-1">
        <SidebarContent sidebar={sidebar} collapsed={collapsed} onNavigate={() => undefined} />
      </div>
      <div className={cn("pb-4", collapsed ? "px-2" : "px-4")}>
        <SidebarHint label={label}>
          <Button
            variant="ghost"
            aria-label={label}
            aria-expanded={collapsed === false}
            aria-controls="desktop-sidebar"
            className="h-10 w-full justify-start rounded-xl px-3"
            onClick={() =>
              sidebar.updatePreferences({ ...sidebar.preferences, collapsed: collapsed === false })
            }
          >
            {collapsed ? <PanelLeftOpenIcon aria-hidden /> : <PanelLeftCloseIcon aria-hidden />}
            <span className={collapsed ? "sr-only" : ""}>Recolher</span>
          </Button>
        </SidebarHint>
      </div>
    </aside>
  );
}
