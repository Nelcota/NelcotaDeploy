/** Thrown when a server id does not exist. */
export class ServerNotFoundError extends Error {
  constructor(serverId: string) {
    super(`Server ${serverId} not found`);
    this.name = "ServerNotFoundError";
  }
}

/** Thrown when another server already uses a name or address. */
export class ServerTakenError extends Error {
  constructor(what: string) {
    super(`A server with this ${what} already exists`);
    this.name = "ServerTakenError";
  }
}

/** Thrown when a server still hosts projects or is the panel's own host. */
export class ServerInUseError extends Error {
  constructor(serverId: string, reason: string) {
    super(`Server ${serverId} cannot be removed: ${reason}`);
    this.name = "ServerInUseError";
  }
}

/** Thrown when a project is moved to a server that is not connected and prepared. */
export class ServerNotReadyError extends Error {
  constructor(serverId: string) {
    super(`Server ${serverId} is not ready for applications`);
    this.name = "ServerNotReadyError";
  }
}

/** Thrown when a project changed after its server move was reviewed. */
export class ProjectMoveReviewChangedError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} changed after its server move was reviewed`);
    this.name = "ProjectMoveReviewChangedError";
  }
}

/** Thrown when an active production deployment prevents a server move. */
export class ProjectMoveInProgressError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} has an active production deployment`);
    this.name = "ProjectMoveInProgressError";
  }
}

/** Thrown when moving a Docker Compose project to another server is requested. */
export class ComposeProjectMoveError extends Error {
  constructor(projectId: string) {
    super(`Docker Compose project ${projectId} cannot move between servers`);
    this.name = "ComposeProjectMoveError";
  }
}

/** Thrown when no server can take a new project. */
export class NoServerAvailableError extends Error {
  constructor() {
    super("No server accepts new applications");
    this.name = "NoServerAvailableError";
  }
}

/** Thrown when the install command would be built from a malformed key or username. */
export class InvalidInstallInputError extends Error {
  constructor(what: string) {
    super(`Cannot build the install command: invalid ${what}`);
    this.name = "InvalidInstallInputError";
  }
}
