import { Link } from "@tanstack/react-router";
import { MenuIcon } from "lucide-react";
import { useState } from "react";

import { NelcotaMark } from "@/web/components/shell/brand-logo";
import { MAIN_AREAS } from "@/web/components/shell/navigation";
import { SidebarGroup } from "@/web/components/shell/sidebar/sidebar-group";
import { SidebarProjects } from "@/web/components/shell/sidebar/sidebar-projects";
import { useProjectList, useSystemStatus } from "@/web/components/shell/use-shell-queries";
import { Button } from "@/web/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/web/components/ui/sheet";

const SIDEBAR_ITEM =
  "group flex h-11 items-center gap-3 rounded-xl px-3 text-[0.95rem] text-muted-foreground transition-colors hover:bg-well hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[status=active]:bg-primary data-[status=active]:text-primary-foreground";

type MainArea = (typeof MAIN_AREAS)[number];

function Brand() {
  return (
    <Link
      to="/"
      aria-label="Nelcota Deploy — Painel"
      className="flex shrink-0 items-center gap-3 rounded-lg px-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <NelcotaMark aria-hidden className="h-8 w-auto" />
      <span className="text-xl font-semibold tracking-tight">Nelcota Deploy</span>
    </Link>
  );
}

function CountBadge({ count }: { readonly count: number }) {
  return (
    <span className="ml-auto min-w-6 rounded-md bg-well px-1.5 py-0.5 text-center text-xs font-medium text-muted-foreground tabular-nums group-data-[status=active]:bg-white/20 group-data-[status=active]:text-primary-foreground">
      {count}
    </span>
  );
}

function AreaLink({
  area,
  count = null,
  onNavigate,
}: {
  readonly area: MainArea;
  readonly count?: number | null;
  readonly onNavigate: () => void;
}) {
  return (
    <Link
      to={area.to}
      activeOptions={{ exact: area.exact }}
      onClick={onNavigate}
      className={SIDEBAR_ITEM}
    >
      <area.icon aria-hidden className="size-[1.15rem] shrink-0" />
      {area.label}
      {count == null || count === 0 ? null : <CountBadge count={count} />}
    </Link>
  );
}

function OverviewAreas({ onNavigate }: { readonly onNavigate: () => void }) {
  const projects = useProjectList();
  const status = useSystemStatus();
  const counts: Readonly<Record<string, number | null>> = {
    "/projects": projects.data?.length ?? null,
    "/deployments": status.data?.activeDeployments ?? null,
  };
  return (
    <SidebarGroup label="Visão geral">
      {MAIN_AREAS.filter((area) => area.group === "overview").map((area) => (
        <AreaLink
          key={area.to}
          area={area}
          count={counts[area.to] ?? null}
          onNavigate={onNavigate}
        />
      ))}
    </SidebarGroup>
  );
}

/** Sidebar body: brand, the overview areas with counts, the projects, and the account area. */
export function SidebarContent({ onNavigate }: { readonly onNavigate: () => void }) {
  return (
    <div className="flex h-full w-full flex-col px-4 pb-5">
      <div className="flex h-20 shrink-0 items-center">
        <Brand />
      </div>
      <nav
        aria-label="Principal"
        className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto pt-4"
      >
        <OverviewAreas onNavigate={onNavigate} />
        <SidebarProjects onNavigate={onNavigate} />
      </nav>
      <div className="border-t border-border pt-5">
        <SidebarGroup label="Sistema">
          {MAIN_AREAS.filter((area) => area.group === "account").map((area) => (
            <AreaLink key={area.to} area={area} onNavigate={onNavigate} />
          ))}
        </SidebarGroup>
      </div>
    </div>
  );
}

/** Menu button that opens the sidebar in a sheet on narrow screens. */
export function MobileNavigation() {
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
        <SidebarContent onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
