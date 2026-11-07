import { useMatchRoute } from "@tanstack/react-router";
import { ChevronDownIcon } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/web/components/ui/button";
import { cn } from "@/web/components/ui/class-names";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/web/components/ui/dropdown-menu";

import { activeNavigationHref, type NavigationDestination } from "./navigation-state";

export type PageNavigationItem = NavigationDestination & {
  readonly label: string;
  readonly group: string;
  readonly exact: boolean;
  readonly link: ReactElement;
};

function MenuItems({ items }: { readonly items: readonly PageNavigationItem[] }) {
  return items.map((item) => (
    <DropdownMenuItem
      key={item.href}
      asChild
      textValue={item.label}
      className="data-[status=active]:bg-secondary data-[status=active]:font-medium data-[status=active]:text-foreground"
    >
      {item.link}
    </DropdownMenuItem>
  ));
}

/** Exposes all destinations in named groups, with a single complete menu on narrow screens. */
export function PageNavigation({
  label,
  items,
}: {
  readonly label: string;
  readonly items: readonly PageNavigationItem[];
}) {
  const matchRoute = useMatchRoute();
  if (items.length === 0) {
    return null;
  }
  const activeHref = activeNavigationHref(items, matchRoute);
  const active = items.find((item) => item.href === activeHref);
  const groups = Map.groupBy(items, (item) => item.group);
  return (
    <nav aria-label={label}>
      <div className="md:hidden">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-auto min-h-11 w-full justify-between gap-3 text-left"
              aria-label={`${label}: ${active?.label ?? "Escolher página"}`}
            >
              <span className="min-w-0">
                <span className="block text-xs font-normal text-muted-foreground">{label}</span>
                <span className="block break-words">{active?.label ?? "Escolher página"}</span>
              </span>
              <ChevronDownIcon aria-hidden className="shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-72 max-w-[calc(100vw-2rem)]"
            aria-label={label}
          >
            {Array.from(groups, ([group, destinations]) => (
              <DropdownMenuGroup key={group} aria-label={group}>
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {group}
                </DropdownMenuLabel>
                <MenuItems items={destinations} />
              </DropdownMenuGroup>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="hidden flex-wrap gap-2 md:flex">
        {Array.from(groups, ([group, destinations]) => (
          <DropdownMenu key={group} modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                aria-label={`${label}: ${group}`}
                className={cn(
                  "gap-2",
                  active?.group === group && "bg-secondary text-foreground ring-1 ring-border",
                )}
                aria-description={
                  active?.group === group ? `Página atual: ${active.label}` : undefined
                }
              >
                {group}
                <ChevronDownIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-72 max-w-[calc(100vw-2rem)]"
              aria-label={group}
            >
              <MenuItems items={destinations} />
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
      </div>
    </nav>
  );
}
