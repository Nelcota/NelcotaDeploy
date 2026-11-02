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

/** Thrown when backing up or restoring a database whose engine the platform does not back up. */
export class DatabaseBackupUnsupportedError extends Error {
  constructor(engine: string) {
    super(`Backups are not available for ${engine} databases`);
    this.name = "DatabaseBackupUnsupportedError";
  }
}

/** Thrown when backing up or restoring a database that is not running. */
export class DatabaseNotRunningError extends Error {
  constructor(databaseId: string, status: string) {
    super(`Database ${databaseId} is ${status}, not running`);
    this.name = "DatabaseNotRunningError";
  }
}

/** Thrown when a backup of the database is already queued or running. */
export class DatabaseBackupInProgressError extends Error {
  constructor(databaseId: string) {
    super(`A backup of database ${databaseId} is already in progress`);
    this.name = "DatabaseBackupInProgressError";
  }
}

/** Thrown when a backup does not exist, belongs to another database or cannot be restored. */
export class DatabaseBackupNotFoundError extends Error {
  constructor(backupId: string) {
    super(`Backup ${backupId} not found or not restorable`);
    this.name = "DatabaseBackupNotFoundError";
  }
}
