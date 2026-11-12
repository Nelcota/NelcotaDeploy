import type { ReactNode } from "react";
import { useState } from "react";

import {
  CommandPalette,
  useCommandPaletteShortcut,
} from "@/web/components/shell/command-palette/command-palette";
import { useDeploymentNotifications } from "@/web/components/shell/notifications/deployment-notifications";
import { DesktopSidebar } from "@/web/components/shell/sidebar/desktop-sidebar";
import { MobileSidebar } from "@/web/components/shell/sidebar/mobile/mobile-sidebar";
import { useSidebarPreferences } from "@/web/components/shell/sidebar/use-sidebar-preferences";
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
 * Application frame with navigation and account controls in the sidebar. Page content
 * and navigation scroll independently, keeping the account and top bar in place.
 */
export function AppShell({
  user,
  children,
}: {
  readonly user: SessionUser;
  readonly children: ReactNode;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const sidebar = useSidebarPreferences(user.id);
  useCommandPaletteShortcut(() => setSearchOpen(true));
  useDeploymentNotifications();
  return (
    // Positioned so absolutely placed descendants (sr-only text, hidden inputs) stay inside
    // the clipped frame instead of growing the document and letting the whole page scroll.
    <div className="relative flex h-svh overflow-hidden bg-background">
      <SkipLink />
      <DesktopSidebar sidebar={sidebar} user={user} onSearch={() => setSearchOpen(true)} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar
          navigation={<MobileSidebar sidebar={sidebar} user={user} />}
          onSearch={() => setSearchOpen(true)}
        />
        <main
          id="main"
          tabIndex={-1}
          data-scroll-restoration-id="main"
          className="relative min-h-0 flex-1 overflow-y-auto bg-panel ring-1 ring-border/60 focus:outline-none lg:rounded-tl-3xl"
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
    <div className={cn("mx-auto w-full max-w-[110rem] space-y-5 p-4 md:p-6", className)}>
      {children}
    </div>
  );
}
