import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

/** Thrown when a configured path would leave the cloned repository. */
export class PathOutsideWorkspaceError extends Error {
  constructor(path: string) {
    super(`Path ${JSON.stringify(path)} resolves outside the repository`);
    this.name = "PathOutsideWorkspaceError";
  }
}

/**
 * Resolves a repository-relative path and checks, after following symlinks, that it stays
 * inside the repository.
 *
 * @param root - Repository directory.
 * @param relativePath - Path from the project settings.
 * @returns The absolute real path.
 * @throws {PathOutsideWorkspaceError} When the path or a symlink points outside the root.
 */
export async function resolveInsideWorkspace(root: string, relativePath: string): Promise<string> {
  const realRoot = await realpath(root);
  const candidate = resolve(realRoot, relativePath);
  let realCandidate: string;
  try {
    realCandidate = await realpath(candidate);
  } catch (error) {
    throw new PathOutsideWorkspaceError(
      `${relativePath} (${error instanceof Error ? error.message : "not found"})`,
    );
  }
  const fromRoot = relative(realRoot, realCandidate);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new PathOutsideWorkspaceError(relativePath);
  }
  return realCandidate;
}

/** A temporary directory for one deployment, removed when disposed. */
export class DeploymentWorkspace implements AsyncDisposable {
  readonly path: string;

  private constructor(path: string) {
    this.path = path;
  }

  /**
   * Creates a fresh directory under the workspace root.
   *
   * @param workspaceRoot - Configured workspace directory.
   * @param prefix - Readable prefix, such as the project slug.
   * @returns The workspace.
   */
  static async create(workspaceRoot: string, prefix: string): Promise<DeploymentWorkspace> {
    await mkdir(workspaceRoot, { recursive: true });
    return new DeploymentWorkspace(await mkdtemp(join(workspaceRoot, `${prefix}-`)));
  }

  /** Directory the repository is cloned into. */
  get repositoryPath(): string {
    return join(this.path, "repository");
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await rm(this.path, { recursive: true, force: true });
  }
}
