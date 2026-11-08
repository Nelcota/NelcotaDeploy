import { Link } from "@tanstack/react-router";

import type { Permission } from "@/shared/roles";

import { visibleSettingsSections } from "./navigation/settings-destinations";

export {
  legacySettingsDestination,
  visibleSettingsSections,
  type ProjectSettingsSection,
} from "./navigation/settings-destinations";

/** Visible links keep every settings page discoverable without horizontal scrolling. */
export function ProjectSettingsNavigation({
  projectId,
  can,
}: {
  readonly projectId: string;
  readonly can: (permission: Permission) => boolean;
}) {
  return (
    <nav aria-label="Páginas dos ajustes">
      <ul className="flex flex-wrap gap-2">
        {visibleSettingsSections(can).map((section) => (
          <li key={section.id}>
            <Link
              to={section.to}
              params={{ projectId }}
              activeOptions={{ exact: true }}
              className="inline-flex min-h-9 items-center rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-well hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[status=active]:bg-well data-[status=active]:text-foreground"
            >
              {section.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
