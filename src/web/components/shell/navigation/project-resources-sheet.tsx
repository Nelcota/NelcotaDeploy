import { Button } from "@/web/components/ui/button";
import { cn } from "@/web/components/ui/class-names";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/web/components/ui/sheet";

import type { ProjectResourceGroups } from "./page-navigation";

function ResourceLinks({
  groups,
  currentHref,
}: {
  readonly groups: ProjectResourceGroups;
  readonly currentHref: string | null;
}) {
  return (
    <nav
      aria-label="Recursos do projeto"
      className="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-4 pb-4"
    >
      {groups.map(([group, resources]) => (
        <div key={group}>
          <h3 className="px-2.5 pb-1 text-xs font-medium text-faint">{group}</h3>
          <ul className="grid grid-cols-2 gap-1 [&_a]:min-h-11 [&_a]:px-2.5 [&_a]:text-sm">
            {resources.map((item) => (
              <li key={item.href} className="min-w-0">
                <SheetClose asChild>{item.renderLink(item.href === currentHref)}</SheetClose>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Makes secondary project pages available as a labeled sheet on narrow screens. */
export function ProjectResourcesSheet({
  groups,
  currentHref,
  currentLabel,
}: {
  readonly groups: ProjectResourceGroups;
  readonly currentHref: string | null;
  readonly currentLabel: string | undefined;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "w-full justify-start gap-1 rounded-lg px-1.5 text-xs",
            currentLabel != null && "bg-well text-foreground",
          )}
          aria-description={currentLabel == null ? undefined : `Página atual: ${currentLabel}`}
        >
          Recursos
          <span aria-hidden className="solar-[alt-arrow-up-linear] size-3.5 shrink-0" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        aria-describedby={undefined}
        className="max-h-[85svh] gap-2 rounded-t-2xl border-sidebar-border pb-[env(safe-area-inset-bottom)] motion-reduce:animate-none"
      >
        <header className="flex items-center justify-between gap-2 px-4 pt-3">
          <SheetTitle>Recursos do projeto</SheetTitle>
          <SheetClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Fechar recursos">
              <span aria-hidden className="solar-[close-linear] size-5" />
            </Button>
          </SheetClose>
        </header>
        <ResourceLinks groups={groups} currentHref={currentHref} />
      </SheetContent>
    </Sheet>
  );
}
