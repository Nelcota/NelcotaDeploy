import { z } from "zod";

export const PINNED_PROJECT_LIMIT = 4;
const MAX_PROJECT_ID_LENGTH = 128;
const MAX_PREFERENCES_LENGTH = 2048;

const preferencesSchema = z.object({
  collapsed: z.boolean(),
  pinnedProjectIds: z
    .array(z.string().trim().min(1).max(MAX_PROJECT_ID_LENGTH))
    .max(PINNED_PROJECT_LIMIT),
});

export type SidebarPreferences = {
  readonly collapsed: boolean;
  readonly pinnedProjectIds: readonly string[];
};

export function defaultSidebarPreferences(): SidebarPreferences {
  return { collapsed: false, pinnedProjectIds: [] };
}

/** Rejects malformed browser preferences without preventing navigation. */
export function parseSidebarPreferences(value: string | null): SidebarPreferences {
  if (value == null || value.trim() === "" || value.length > MAX_PREFERENCES_LENGTH) {
    return defaultSidebarPreferences();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    console.warn("Invalid sidebar preferences JSON", error);
    return defaultSidebarPreferences();
  }
  const result = preferencesSchema.safeParse(parsed);
  if (result.success === false) {
    return defaultSidebarPreferences();
  }
  return { ...result.data, pinnedProjectIds: [...new Set(result.data.pinnedProjectIds)] };
}

/** Keeps only visible projects, preserving the user's pin order after deletions or access changes. */
export function visiblePinnedProjectIds(
  pinnedProjectIds: readonly string[],
  availableProjectIds: readonly string[],
): string[] {
  const available = new Set(availableProjectIds);
  return pinnedProjectIds.filter((id) => available.has(id)).slice(0, PINNED_PROJECT_LIMIT);
}

/** Adds or removes a visible project while keeping at most four pins. */
export function togglePinnedProject(
  preferences: SidebarPreferences,
  projectId: string,
  availableProjectIds: readonly string[],
): SidebarPreferences {
  const pinnedProjectIds = visiblePinnedProjectIds(
    preferences.pinnedProjectIds,
    availableProjectIds,
  );
  if (availableProjectIds.includes(projectId) === false || projectId.trim() === "") {
    return { ...preferences, pinnedProjectIds };
  }
  if (pinnedProjectIds.includes(projectId)) {
    return { ...preferences, pinnedProjectIds: pinnedProjectIds.filter((id) => id !== projectId) };
  }
  if (pinnedProjectIds.length >= PINNED_PROJECT_LIMIT) {
    return { ...preferences, pinnedProjectIds };
  }
  return { ...preferences, pinnedProjectIds: [...pinnedProjectIds, projectId] };
}
