import type { ReactNode } from "react";
import { useState } from "react";

import {
  CommandPalette,
  useCommandPaletteShortcut,
} from "@/web/components/shell/command-palette/command-palette";
import { useDeploymentNotifications } from "@/web/components/shell/notifications/deployment-notifications";
import { MobileNavigation, SidebarContent } from "@/web/components/shell/sidebar/sidebar";
import { TopBar } from "@/web/components/shell/top-bar/top-bar";
import { cn } from "@/web/components/ui/class-names";
import type { SessionUser } from "@/web/functions/session.functions";

function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
    >
      Pular para o conteúdo
    </a>
  );
}

/**
 * Application frame: a sidebar with the areas and projects, a top bar with shortcuts,
 * search, refresh, system status and account, and the page on a raised panel. Only the
 * panel scrolls, so the bars stay put and page content never slides under them.
 */
export function AppShell({
  user,
  children,
}: {
  readonly user: SessionUser;
  readonly children: ReactNode;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  useCommandPaletteShortcut(() => setSearchOpen(true));
  useDeploymentNotifications();
  return (
    <div className="flex h-svh overflow-hidden bg-background">
      <SkipLink />
      <aside className="hidden h-full w-[17rem] shrink-0 lg:flex">
        <SidebarContent onNavigate={() => undefined} />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar
          user={user}
          navigation={<MobileNavigation />}
          onSearch={() => setSearchOpen(true)}
        />
        <main
          id="main"
          tabIndex={-1}
          data-scroll-restoration-id="main"
          className="min-h-0 flex-1 overflow-y-auto bg-panel ring-1 ring-border/60 focus:outline-none lg:rounded-tl-3xl"
        >
          {children}
        </main>
      </div>
      <CommandPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        permissions={user.permissions}
      />
    </div>
  );
}

/** Standard page body: full-width column with vertical rhythm. */
export function PageBody({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[110rem] space-y-6 p-4 md:p-6", className)}>
      {children}
    </div>
  );
}
