/** Thrown when a variable id does not belong to the project. */
export class EnvironmentVariableNotFoundError extends Error {
  constructor(variableId: string) {
    super(`Environment variable ${variableId} not found`);
    this.name = "EnvironmentVariableNotFoundError";
  }
}

/** Thrown when a deployment's encrypted redaction snapshot is missing or malformed. */
export class InvalidEnvironmentSnapshotError extends Error {
  constructor(deploymentId: string) {
    super(`Invalid environment snapshot for deployment ${deploymentId}`);
    this.name = "InvalidEnvironmentSnapshotError";
  }
}
