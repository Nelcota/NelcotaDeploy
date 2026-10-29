/** Thrown when a configured path would leave the cloned repository. */
export class PathOutsideWorkspaceError extends Error {
  constructor(path: string) {
    super(`Path ${JSON.stringify(path)} resolves outside the repository`);
    this.name = "PathOutsideWorkspaceError";
  }
}

/** Thrown when a running deployment is cancelled at a checkpoint. */
export class DeploymentCancelledError extends Error {
  constructor() {
    super("Deployment cancelled by a user");
    this.name = "DeploymentCancelledError";
  }
}
