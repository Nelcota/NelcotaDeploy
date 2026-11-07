/** Thrown when a Compose file asks for something that would reach beyond its own project. */
export class InvalidComposeFileError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`The Compose file cannot be deployed: ${problems.join("; ")}`);
    this.name = "InvalidComposeFileError";
    this.problems = problems;
  }
}

/** Thrown when the Compose file cannot be read from or written to the workspace. */
export class ComposeWorkspaceError extends Error {
  constructor(message: string) {
    super(`Compose workspace command failed: ${message}`);
    this.name = "ComposeWorkspaceError";
  }
}
