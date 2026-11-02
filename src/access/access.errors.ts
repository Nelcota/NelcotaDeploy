/** Thrown when a user cannot become a member of a project, such as an admin or a missing user. */
export class InvalidProjectMemberError extends Error {
  constructor(reason: string) {
    super(`Invalid project member: ${reason}`);
    this.name = "InvalidProjectMemberError";
  }
}

/** Thrown when a user is not a member of the project being changed. */
export class ProjectMemberNotFoundError extends Error {
  constructor(projectId: string, userId: string) {
    super(`User ${userId} is not a member of project ${projectId}`);
    this.name = "ProjectMemberNotFoundError";
  }
}
