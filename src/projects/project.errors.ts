/** Thrown when a project id does not exist or is being deleted. */
export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} not found`);
    this.name = "ProjectNotFoundError";
  }
}

/** Thrown when another project already uses a slug. */
export class ProjectSlugTakenError extends Error {
  constructor(slug: string) {
    super(`Project slug ${slug} is already in use`);
    this.name = "ProjectSlugTakenError";
  }
}
