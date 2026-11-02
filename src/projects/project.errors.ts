/** Thrown when a project id does not exist or is being deleted. */
export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} not found`);
    this.name = "ProjectNotFoundError";
  }
}

/** Thrown when a project with mounted volumes is given more than one replica. */
export class ReplicasNeedNoVolumesError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} mounts volumes, so it can run only one replica`);
    this.name = "ReplicasNeedNoVolumesError";
  }
}

/** Thrown when another project already uses a slug. */
export class ProjectSlugTakenError extends Error {
  constructor(slug: string) {
    super(`Project slug ${slug} is already in use`);
    this.name = "ProjectSlugTakenError";
  }
}
