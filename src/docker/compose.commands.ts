import { InvalidDockerArgumentError } from "./docker.errors";

const PROJECT_ID_PATTERN = /^[0-9a-fA-F-]{1,64}$/;
const SERVICE_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,62}$/;
const PATH_PATTERN = /^\/[^\0\n]*$/;

/** Where a Compose project's files are and the name Compose groups its resources under. */
export type ComposeProjectFiles = {
  readonly projectName: string;
  /** Absolute paths of the Compose files, in order. */
  readonly files: readonly string[];
  /** Absolute folder relative paths in the files resolve against. */
  readonly directory: string;
};

/**
 * Returns the Compose project name of a platform project. It derives from the id, not the
 * slug, so renaming the project never loses its volumes.
 *
 * @param projectId - Project UUID.
 * @returns A name such as "nelcota-0190f6a1b2c37d4e8f9a0b1c2d3e4f5a".
 * @throws {InvalidDockerArgumentError} When the id is malformed.
 */
export function composeProjectNameFor(projectId: string): string {
  if (PROJECT_ID_PATTERN.test(projectId) === false) {
    throw new InvalidDockerArgumentError(`Invalid project id: ${JSON.stringify(projectId)}`);
  }
  return `nelcota-${projectId.replaceAll("-", "").toLowerCase()}`;
}

/**
 * Returns the name Compose gives the first container of a service.
 *
 * @param projectName - From {@link composeProjectNameFor}.
 * @param service - Lowercase service name.
 * @returns A name such as "nelcota-0190f6a1…-web-1".
 * @throws {InvalidDockerArgumentError} When the service name is malformed.
 */
export function composeContainerNameFor(projectName: string, service: string): string {
  if (SERVICE_PATTERN.test(service) === false) {
    throw new InvalidDockerArgumentError(`Invalid Compose service: ${JSON.stringify(service)}`);
  }
  return `${projectName}-${service}-1`;
}

function composeBaseArgs(project: ComposeProjectFiles): string[] {
  if (project.files.length === 0) {
    throw new InvalidDockerArgumentError("A Compose project needs at least one file");
  }
  for (const path of [...project.files, project.directory]) {
    if (PATH_PATTERN.test(path) === false) {
      throw new InvalidDockerArgumentError(`Invalid Compose path: ${JSON.stringify(path)}`);
    }
  }
  return [
    "compose",
    "--project-name",
    project.projectName,
    "--project-directory",
    project.directory,
    ...project.files.flatMap((file) => ["--file", file]),
  ];
}

/**
 * Builds the command that prints the normalized model, without reading env files, so the
 * paths they name can be checked before anything opens them.
 *
 * @param project - Name, files and folder of the Compose project.
 * @returns Arguments for the docker CLI.
 * @throws {InvalidDockerArgumentError} When there is no file or a path is not absolute.
 */
export function composeConfigArgs(project: ComposeProjectFiles): string[] {
  return [...composeBaseArgs(project), "config", "--format", "json", "--no-env-resolution"];
}

/**
 * Builds the command that builds and starts the project's services, recreating the ones whose
 * configuration changed and removing services the file no longer has.
 *
 * @param project - Name, files and folder of the Compose project.
 * @returns Arguments for the docker CLI.
 * @throws {InvalidDockerArgumentError} When there is no file or a path is not absolute.
 */
export function composeUpArgs(project: ComposeProjectFiles): string[] {
  return [...composeBaseArgs(project), "up", "--detach", "--build", "--remove-orphans"];
}
