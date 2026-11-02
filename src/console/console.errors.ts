/** Thrown when a console command is empty, too long or has characters a shell cannot take. */
export class InvalidConsoleCommandError extends Error {
  constructor(reason: string) {
    super(`Invalid console command: ${reason}`);
    this.name = "InvalidConsoleCommandError";
  }
}

/** Thrown when the same person already has a command waiting or running on the project. */
export class ConsoleBusyError extends Error {
  constructor(projectId: string) {
    super(`A console command is already running on project ${projectId}`);
    this.name = "ConsoleBusyError";
  }
}

/** Thrown when the project has no live container to run the command in. */
export class ConsoleUnavailableError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} has no live container`);
    this.name = "ConsoleUnavailableError";
  }
}

/** Thrown when a console command does not exist or belongs to someone else. */
export class ConsoleCommandNotFoundError extends Error {
  constructor(commandId: string) {
    super(`Console command ${commandId} not found`);
    this.name = "ConsoleCommandNotFoundError";
  }
}
