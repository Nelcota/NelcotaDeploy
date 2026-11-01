/** Thrown when a database does not exist or belongs to another project. */
export class DatabaseNotFoundError extends Error {
  constructor(databaseId: string) {
    super(`Database ${databaseId} not found`);
    this.name = "DatabaseNotFoundError";
  }
}

/** Thrown when a project already has the most databases it may have. */
export class DatabaseLimitError extends Error {
  constructor(limit: number) {
    super(`A project can have at most ${limit} databases`);
    this.name = "DatabaseLimitError";
  }
}

/** Thrown when the variable meant for the connection URL already exists in the project. */
export class DatabaseVariableConflictError extends Error {
  constructor(environmentKey: string) {
    super(`The project already has a variable named ${environmentKey}`);
    this.name = "DatabaseVariableConflictError";
  }
}

/** Thrown when changing a database that is being deleted. */
export class DatabaseBeingDeletedError extends Error {
  constructor(databaseId: string) {
    super(`Database ${databaseId} is being deleted`);
    this.name = "DatabaseBeingDeletedError";
  }
}

/** Thrown when moving a project whose databases would stay behind on its current server. */
export class ProjectHasDatabasesError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} has databases on its current server`);
    this.name = "ProjectHasDatabasesError";
  }
}
