import { useState } from "react";

import { SidebarContent } from "@/web/components/shell/sidebar/sidebar";
import type { SidebarState } from "@/web/components/shell/sidebar/use-sidebar-preferences";
import { Button } from "@/web/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/web/components/ui/sheet";
import type { SessionUser } from "@/web/functions/session.functions";

/** Menu button that opens the full sidebar in a sheet on narrow screens. */
export function MobileSidebar({
  sidebar,
  user,
}: {
  readonly sidebar: SidebarState;
  readonly user: SessionUser;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Abrir menu" className="lg:hidden">
          <span aria-hidden className="solar-[hamburger-menu-linear] size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        aria-describedby={undefined}
        showCloseButton={false}
        className="w-64 max-w-full border-sidebar-border p-0"
      >
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <SidebarContent
          sidebar={sidebar}
          user={user}
          onNavigate={() => setOpen(false)}
          actions={
            <SheetClose asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Fechar menu">
                <span aria-hidden className="solar-[close-linear] size-5" />
              </Button>
            </SheetClose>
          }
        />
      </SheetContent>
    </Sheet>
  );
}
