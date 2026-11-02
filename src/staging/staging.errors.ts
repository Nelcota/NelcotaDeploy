/** Thrown when creating a staging environment for a project that is itself an environment. */
export class NotAProductionProjectError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} is an environment of another project`);
    this.name = "NotAProductionProjectError";
  }
}

/** Thrown when a project already has a staging environment, or one is still being deleted. */
export class StagingAlreadyExistsError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} already has a staging environment`);
    this.name = "StagingAlreadyExistsError";
  }
}

/** Thrown when promoting a project that is not a staging environment. */
export class NotAStagingEnvironmentError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} is not a staging environment`);
    this.name = "NotAStagingEnvironmentError";
  }
}

/** Thrown when promoting a staging environment that has no successful deployment yet. */
export class NothingToPromoteError extends Error {
  constructor(projectId: string) {
    super(`Staging project ${projectId} has no live deployment to promote`);
    this.name = "NothingToPromoteError";
  }
}

/** Thrown when staging builds another repository than production, so its commit means nothing there. */
export class PromotionRepositoryMismatchError extends Error {
  constructor(stagingRepository: string, productionRepository: string) {
    super(`Staging builds ${stagingRepository} but production builds ${productionRepository}`);
    this.name = "PromotionRepositoryMismatchError";
  }
}

/** Thrown when the branch of a new staging environment is not a valid git branch name. */
export class InvalidStagingBranchError extends Error {
  constructor(branch: string) {
    super(`Invalid branch for staging: ${JSON.stringify(branch)}`);
    this.name = "InvalidStagingBranchError";
  }
}
