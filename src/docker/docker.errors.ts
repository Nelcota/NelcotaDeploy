/** Thrown when a value would produce an unsafe or invalid docker argument. */
export class InvalidDockerArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDockerArgumentError";
  }
}

/** Thrown when a docker command exits with a non-zero code. */
export class DockerCommandError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "DockerCommandError";
    this.exitCode = exitCode;
  }
}

/** Thrown when an operation targets a container or image the platform does not manage. */
export class UnmanagedResourceError extends Error {
  constructor(resource: string) {
    super(`Refusing to touch ${resource}: it is not managed by the platform`);
    this.name = "UnmanagedResourceError";
  }
}
