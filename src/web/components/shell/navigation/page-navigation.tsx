import { useMatchRoute } from "@tanstack/react-router";
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
import { ProjectResourcesSheet } from "./project-resources-sheet";

export type PageNavigationItem = NavigationDestination & {
  readonly label: string;
  readonly primary: boolean;
  readonly group: string;
  readonly renderLink: (current: boolean) => ReactElement;
};

export type ProjectResourceGroups = readonly (readonly [string, readonly PageNavigationItem[]])[];

const RESOURCE_GROUP_ORDER: ReadonlyMap<string, number> = new Map([
  ["Configuração", 0],
  ["Dados e tarefas", 1],
  ["Publicação", 2],
]);

type ResourcesMenuProps = {
  readonly groups: ProjectResourceGroups;
  readonly currentHref: string | null;
  readonly currentLabel: string | undefined;
};

function DesktopResourcesMenu({ groups, currentHref, currentLabel }: ResourcesMenuProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "rounded-lg px-2.5 data-[state=open]:bg-well data-[state=open]:text-foreground",
            currentLabel != null && "bg-well text-foreground",
          )}
          aria-description={currentLabel == null ? undefined : `Página atual: ${currentLabel}`}
        >
          Recursos
          <span aria-hidden className="solar-[alt-arrow-down-linear] size-3.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 divide-y divide-border">
        {groups.map(([group, resources]) => (
          <DropdownMenuGroup key={group} aria-label={group} className="py-1">
            <DropdownMenuLabel className="text-xs text-faint">{group}</DropdownMenuLabel>
            {resources.map((item) => (
              <DropdownMenuItem key={item.href} asChild textValue={item.label}>
                {item.renderLink(item.href === currentHref)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectResources({
  items,
  currentHref,
}: {
  readonly items: readonly PageNavigationItem[];
  readonly currentHref: string | null;
}) {
  if (items.length === 0) {
    return null;
  }

  const groups = [...Map.groupBy(items, (item) => item.group)].toSorted(
    ([first], [second]) =>
      (RESOURCE_GROUP_ORDER.get(first) ?? Number.MAX_SAFE_INTEGER) -
      (RESOURCE_GROUP_ORDER.get(second) ?? Number.MAX_SAFE_INTEGER),
  );
  const currentLabel = items.find((item) => item.href === currentHref)?.label;
  return (
    <li>
      <div className="sm:hidden">
        <ProjectResourcesSheet
          groups={groups}
          currentHref={currentHref}
          currentLabel={currentLabel}
        />
      </div>
      <div className="hidden sm:block">
        <DesktopResourcesMenu
          groups={groups}
          currentHref={currentHref}
          currentLabel={currentLabel}
        />
      </div>
    </li>
  );
}

/** Keeps common project pages one click away at any width. */
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

  const currentHref = activeNavigationHref(items, matchRoute);
  return (
    <nav aria-label={label} className="border-b border-border pb-2">
      <ul className="grid grid-cols-[minmax(0,1fr)_minmax(max-content,1fr)_minmax(0,1fr)] gap-1 sm:flex sm:flex-wrap sm:items-center">
        {items
          .filter((item) => item.primary)
          .map((item) => (
            <li key={item.href}>{item.renderLink(item.href === currentHref)}</li>
          ))}
        <ProjectResources
          items={items.filter((item) => item.primary === false)}
          currentHref={currentHref}
        />
      </ul>
    </nav>
  );
}
