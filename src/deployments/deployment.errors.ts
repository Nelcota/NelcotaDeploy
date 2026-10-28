/** Thrown when a deployment id does not exist. */
export class DeploymentNotFoundError extends Error {
  constructor(deploymentId: string) {
    super(`Deployment ${deploymentId} not found`);
    this.name = "DeploymentNotFoundError";
  }
}

/** Thrown when a project's code has not been approved by an admin yet. */
export class ProjectNotApprovedError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} must be approved by an admin before it can deploy`);
    this.name = "ProjectNotApprovedError";
  }
}

/** Thrown when a rollback target has no reusable image. */
export class RollbackUnavailableError extends Error {
  constructor(reason: string) {
    super(`Rollback unavailable: ${reason}`);
    this.name = "RollbackUnavailableError";
  }
}

/** Thrown when a container action needs a deployed container and there is none. */
export class NoActiveContainerError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} has no deployed container`);
    this.name = "NoActiveContainerError";
  }
}
