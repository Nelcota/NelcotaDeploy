import { Link } from "@tanstack/react-router";
import { MenuIcon } from "lucide-react";
import { useState } from "react";

import { NelcotaMark } from "@/web/components/shell/brand-logo";
import { MAIN_GROUPS } from "@/web/components/shell/navigation";
import { SidebarAreas } from "@/web/components/shell/sidebar/sidebar-link";
import { SidebarProjects } from "@/web/components/shell/sidebar/sidebar-projects";
import type { SidebarState } from "@/web/components/shell/sidebar/use-sidebar-preferences";
import { Button } from "@/web/components/ui/button";
import { cn } from "@/web/components/ui/class-names";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/web/components/ui/sheet";

function Brand({ collapsed }: { readonly collapsed: boolean }) {
  return (
    <Link
      to="/"
      aria-label="Nelcota Deploy — Painel"
      className="flex min-w-0 shrink-0 items-center gap-3 rounded-lg px-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <NelcotaMark aria-hidden className="h-8 w-auto shrink-0" />
      <span className={collapsed ? "sr-only" : "truncate text-xl font-semibold tracking-tight"}>
        Nelcota Deploy
      </span>
    </Link>
  );
}

export function SidebarContent({
  sidebar,
  collapsed = false,
  onNavigate,
}: {
  readonly sidebar: SidebarState;
  readonly collapsed?: boolean;
  readonly onNavigate: () => void;
}) {
  return (
    <div className={cn("flex h-full w-full flex-col pb-5", collapsed ? "px-2" : "px-4")}>
      <div className="flex h-20 shrink-0 items-center">
        <Brand collapsed={collapsed} />
      </div>
      <nav
        aria-label="Principal"
        className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto pt-4"
      >
        {MAIN_GROUPS.map((group) => (
          <SidebarAreas
            key={group.id}
            group={group.id}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
        <SidebarProjects sidebar={sidebar} collapsed={collapsed} onNavigate={onNavigate} />
      </nav>
      <div className="shrink-0 border-t border-border pt-5">
        <SidebarAreas group="account" collapsed={collapsed} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

/** Menu button that opens the full sidebar in a sheet on narrow screens. */
export function MobileNavigation({ sidebar }: { readonly sidebar: SidebarState }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Abrir menu" className="lg:hidden">
          <MenuIcon aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 bg-background p-0">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <SidebarContent sidebar={sidebar} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
