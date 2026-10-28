/** Thrown when a variable id does not belong to the project. */
export class EnvironmentVariableNotFoundError extends Error {
  constructor(variableId: string) {
    super(`Environment variable ${variableId} not found`);
    this.name = "EnvironmentVariableNotFoundError";
  }
}
