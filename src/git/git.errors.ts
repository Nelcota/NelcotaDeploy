/** Thrown when a git command fails. The message never contains credentials. */
export class GitCommandError extends Error {
  readonly checkoutFailure: "repository_access" | "branch_not_found" | null;

  constructor(message: string, checkoutFailure: GitCommandError["checkoutFailure"] = null) {
    super(message);
    this.name = "GitCommandError";
    this.checkoutFailure = checkoutFailure;
  }
}
