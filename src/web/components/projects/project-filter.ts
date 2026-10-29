import { matchesApplicationFilter } from "./project-accent";

/** Filters of the project list, as they appear in its URL. */
export type ProjectStatusFilter = "all" | "online" | "offline" | "never" | "pending";

type FilterableProject = {
  readonly containerState: string | null;
  readonly containerHealth: string | null;
  readonly deploymentsApproved: boolean;
};

/**
 * Tells whether a project belongs in the project list under a filter. Online, attention and
 * never-deployed follow the dashboard rules, so a shortcut's count matches the list it opens.
 *
 * @param project - Container state and approval of the project.
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
      return matchesApplicationFilter("online", project.containerState, project.containerHealth);
    case "offline":
      return matchesApplicationFilter("attention", project.containerState, project.containerHealth);
    case "never":
      return matchesApplicationFilter(
        "never-deployed",
        project.containerState,
        project.containerHealth,
      );
    case "pending":
      return project.deploymentsApproved === false;
  }
}
