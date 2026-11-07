import type { Actor } from "@/audit";
import type { Database } from "@/db";
import type { ProjectSettingsChange } from "@/shared/schemas/settings/project-settings.schema";

import { getProject, type Project, updateProject } from "./project.service";

/**
 * Saves one settings page while preserving the latest values owned by the other pages.
 * @param database - Database whose writer is reserved before reading the current settings.
 * @param update - Project, validated page fields and authorized editor.
 * @returns The updated project, without credentials.
 * @throws {ProjectNotFoundError} When the project is missing.
 * @throws {ProjectSlugTakenError} When another project uses the identifier.
 */
export function updateProjectSettings(
  database: Database,
  update: {
    readonly projectId: string;
    readonly change: ProjectSettingsChange;
    readonly editor: { readonly actor: Actor; readonly isAdmin: boolean };
  },
): Project {
  return database.transaction(
    (transaction) => {
      const current = getProject(transaction, update.projectId);
      return updateProject(transaction, {
        projectId: update.projectId,
        input: {
          ...current,
          internalPort: current.internalPortAuto ? null : current.internalPort,
          ...update.change.project,
        },
        editor: update.editor,
      });
    },
    { behavior: "immediate" },
  );
}
