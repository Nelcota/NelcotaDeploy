import { Link } from "@tanstack/react-router";

import type { Permission } from "@/shared/roles";
import { cn } from "@/web/components/ui/class-names";

import {
  type ProjectSettingsSection,
  visibleSettingsSections,
} from "./navigation/settings-destinations";

export {
  legacySettingsDestination,
  visibleSettingsSections,
  type ProjectSettingsSection,
} from "./navigation/settings-destinations";

function ProjectSettingLink({
  projectId,
  section,
  overview,
  current,
}: {
  readonly projectId: string;
  readonly section: ReturnType<typeof visibleSettingsSections>[number];
  readonly overview: boolean;
  readonly current: boolean;
}) {
  return (
    <Link
      to={section.to}
      params={{ projectId }}
      activeOptions={{ exact: true }}
      aria-current={current ? "page" : undefined}
      preload={false}
      className={cn(
        "flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-well hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=page]:bg-well aria-[current=page]:font-semibold aria-[current=page]:text-foreground",
        overview && "min-h-11 px-3 font-medium text-foreground",
      )}
    >
      <span aria-hidden className={cn("size-4 shrink-0", section.icon)} />
      <span className="min-w-0 flex-1">{section.label}</span>
      {overview ? (
        <span aria-hidden className="solar-[alt-arrow-right-linear] size-4 shrink-0 text-faint" />
      ) : null}
    </Link>
  );
}

/** Shows available settings by purpose in the index and beside wide detail pages. */
export function ProjectSettingsNavigation({
  projectId,
  can,
  overview = false,
  current,
}: {
  readonly projectId: string;
  readonly can: (permission: Permission) => boolean;
  readonly overview?: boolean;
  readonly current?: ProjectSettingsSection;
}) {
  const groups = Map.groupBy(visibleSettingsSections(can), (section) => section.group);
  return (
    <nav
      aria-label="Configurações do projeto"
      className={overview ? "grid gap-4 md:auto-rows-fr md:grid-cols-2" : "space-y-4"}
    >
      {Array.from(groups, ([group, sections]) => (
        <div
          key={group}
          className={overview ? "rounded-xl border border-border bg-surface-raised p-2" : undefined}
        >
          <p
            className={cn(
              "px-2.5 text-xs font-semibold text-faint",
              overview && "px-3 py-2 text-sm text-foreground",
            )}
          >
            {group}
          </p>
          <ul>
            {sections.map((section) => (
              <li key={section.id}>
                <ProjectSettingLink
                  projectId={projectId}
                  section={section}
                  overview={overview}
                  current={current === section.id}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
