/** Thrown when a git command fails. The message never contains credentials. */
export class GitCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitCommandError";
  }
}
