import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";

import {
  type AdministrationSection,
  visibleAdministrationSections,
} from "@/web/components/shell/navigation/administration-destinations";
import { useCan } from "@/web/components/shell/use-permissions";
import { cn } from "@/web/components/ui/class-names";

function OverviewLink({ section }: { readonly section: AdministrationSection }) {
  return (
    <Link
      to={section.to}
      preload={false}
      className="flex h-full min-h-14 items-start gap-3 rounded-lg p-2.5 hover:bg-well focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"
      >
        <span className={cn("size-5", section.solarIcon)} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{section.label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          {section.description}
        </span>
      </span>
      <span
        aria-hidden
        className="solar-[alt-arrow-right-linear] mt-0.5 size-4 shrink-0 text-muted-foreground"
      />
    </Link>
  );
}

/** Lists available administration settings and explains where to perform each task. */
export function AdministrationOverview() {
  const can = useCan();
  const groups = Map.groupBy(visibleAdministrationSections(can), (section) => section.group);
  const optionRows = Math.max(1, ...Array.from(groups.values(), (sections) => sections.length));
  const tracks = {
    "--administration-option-rows": `repeat(${optionRows}, minmax(min-content, 1fr))`,
  } as CSSProperties;

  return (
    <nav aria-label="Todas as seções da administração" className="@container/overview">
      <div
        style={tracks}
        className="grid gap-3 @min-[34rem]/overview:auto-rows-fr @min-[34rem]/overview:grid-cols-2"
      >
        {Array.from(groups, ([group, destinations]) => (
          <div
            key={group}
            className="min-w-0 rounded-xl border border-border bg-surface-raised p-2 @min-[34rem]/overview:grid @min-[34rem]/overview:grid-rows-[auto_1fr]"
          >
            <h2 className="px-2.5 py-1.5 text-sm font-semibold">{group}</h2>
            <ul className="@min-[34rem]/overview:grid @min-[34rem]/overview:grid-rows-(--administration-option-rows)">
              {destinations.map((section) => (
                <li key={section.to}>
                  <OverviewLink section={section} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
