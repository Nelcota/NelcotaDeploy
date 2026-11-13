import { Link } from "@tanstack/react-router";

import { useCan } from "@/web/components/shell/use-permissions";
import { cn } from "@/web/components/ui/class-names";

import {
  type ProjectSettingsDestination,
  SETTINGS_HEADING_ID,
  visibleSettingsSections,
} from "./settings-destinations";

function OverviewLink({
  projectId,
  destination,
}: {
  readonly projectId: string;
  readonly destination: ProjectSettingsDestination;
}) {
  return (
    <Link
      to={destination.to}
      params={{ projectId }}
      hash={SETTINGS_HEADING_ID}
      preload={false}
      className="flex items-center gap-3 rounded-lg p-2.5 hover:bg-well focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span
        aria-hidden
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground",
          destination.id === "deletion" && "bg-destructive/10 text-destructive",
        )}
      >
        <span className={cn("size-5", destination.icon)} />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-sm font-semibold",
            destination.id === "deletion" && "text-destructive",
          )}
        >
          {destination.label}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          {destination.description}
        </span>
      </span>
      <span
        aria-hidden
        className="solar-[alt-arrow-right-linear] size-4 shrink-0 text-muted-foreground"
      />
    </Link>
  );
}

/** Explains the purpose of each available settings page. */
export function ProjectSettingsOverview({ projectId }: { readonly projectId: string }) {
  const can = useCan();
  const groups = Map.groupBy(visibleSettingsSections(can), (destination) => destination.group);
  return (
    <nav aria-label="Todas as seções de configuração" className="@container/overview">
      <div className="grid items-start gap-3 @min-[34rem]/overview:grid-cols-2">
        {Array.from(groups, ([group, destinations]) => (
          <div
            key={group}
            className="min-w-0 rounded-xl border border-border bg-surface-raised p-2"
          >
            <h3 className="px-2.5 py-1.5 text-sm font-semibold">{group}</h3>
            <ul>
              {destinations.map((destination) => (
                <li key={destination.id}>
                  <OverviewLink projectId={projectId} destination={destination} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
