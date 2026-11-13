import type { ProjectRuntimeStatus } from "@/projects";

import { matchesApplicationFilter } from "./project-accent";

/** Filters of the project list, as they appear in its URL. */
export type ProjectStatusFilter = "all" | "online" | "offline" | "https" | "never" | "pending";

type FilterableProject = {
  readonly runtimeStatus: ProjectRuntimeStatus;
  readonly deploymentsApproved: boolean;
  readonly httpsIssueDomains?: readonly string[];
};

/**
 * Tells whether a project belongs in the project list under a filter. Online, attention and
 * never-deployed follow the dashboard rules, so a shortcut's count matches the list it opens.
 *
 * @param project - Runtime status and approval of the project.
 * @param filter - Filter chosen in the list ("offline" is shown as "Precisam de atenção").
 * @returns True when the project should be listed.
 */
export function matchesProjectFilter(
  project: FilterableProject,
  filter: ProjectStatusFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "online":
      return matchesApplicationFilter("online", project.runtimeStatus);
    case "offline":
      return matchesApplicationFilter("attention", project.runtimeStatus);
    case "https":
      return (project.httpsIssueDomains?.length ?? 0) > 0;
    case "never":
      return matchesApplicationFilter("never-deployed", project.runtimeStatus);
    case "pending":
      return project.deploymentsApproved === false;
  }
}
