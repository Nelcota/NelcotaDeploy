import { Link } from "@tanstack/react-router";

import { SETTINGS_SECTIONS } from "@/web/components/shell/navigation";
import { useCan } from "@/web/components/shell/use-permissions";
import { cn } from "@/web/components/ui/class-names";

type AdministrationSection = (typeof SETTINGS_SECTIONS)[number];

function AdministrationLink({
  section,
  overview,
}: {
  readonly section: AdministrationSection;
  readonly overview: boolean;
}) {
  return (
    <Link
      to={section.to}
      activeOptions={{ exact: true }}
      preload={false}
      className={cn(
        "flex items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-well hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=page]:border-border aria-[current=page]:bg-well aria-[current=page]:font-semibold aria-[current=page]:text-foreground forced-colors:aria-[current=page]:border-[Highlight]",
        overview && "min-h-14 gap-3 px-3 py-2.5 text-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid shrink-0 place-items-center text-muted-foreground",
          overview && "size-9 rounded-lg bg-well",
        )}
      >
        <span className={cn("size-4", section.solarIcon, overview && "size-[1.125rem]")} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block", overview && "font-semibold")}>{section.label}</span>
        {overview ? (
          <span className="block text-xs leading-5 text-muted-foreground">
            {section.description}
          </span>
        ) : null}
      </span>
      {overview ? (
        <span aria-hidden className="solar-[alt-arrow-right-linear] size-4 shrink-0 text-faint" />
      ) : null}
    </Link>
  );
}

/** Shows the available administration destinations on the overview and beside detail pages. */
export function AdministrationNavigation({ overview = false }: { readonly overview?: boolean }) {
  const can = useCan();
  const sections = SETTINGS_SECTIONS.filter(
    (section) => section.permission == null || can(section.permission),
  );
  const groups = Map.groupBy(sections, (section) => section.group);

  return (
    <nav
      aria-label="Seções da administração"
      className={overview ? "grid auto-rows-fr gap-4 md:grid-cols-2" : "space-y-4"}
    >
      {Array.from(groups, ([group, destinations]) => (
        <div
          key={group}
          className={overview ? "rounded-xl border border-border bg-surface-raised p-2" : undefined}
        >
          <h2
            className={cn(
              "px-2.5 text-xs font-semibold text-faint",
              overview && "px-3 pt-2 pb-1 text-sm text-foreground",
            )}
          >
            {group}
          </h2>
          <ul className="space-y-0.5">
            {destinations.map((section) => (
              <li key={section.to}>
                <AdministrationLink section={section} overview={overview} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
