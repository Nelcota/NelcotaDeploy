import { posix } from "node:path";

import type { CommandRunner, ProcessResult } from "@/process";

import { PathOutsideWorkspaceError, WorkspaceCommandError } from "../worker.errors";

const COMMAND_TIMEOUT_IN_MS = 30_000;
// Deleting a large checkout with node_modules can take a while on a slow disk.
const REMOVE_TIMEOUT_IN_MS = 120_000;

async function runChecked(
  runner: CommandRunner,
  command: readonly string[],
  timeoutInMs: number = COMMAND_TIMEOUT_IN_MS,
): Promise<string> {
  const result: ProcessResult = await runner(command, { timeoutInMs });
  if (result.exitCode !== 0) {
    const reason = result.stderr.trim().split("\n").at(-1) ?? "";
    throw new WorkspaceCommandError(`${command[0] ?? ""} failed: ${reason}`);
  }
  return result.stdout;
}

/**
 * Resolves a repository-relative path and checks, after following symlinks, that it stays
 * inside the repository.
 *
 * @remarks
 * Runs `realpath` through the runner, so the check happens on the server that holds the
 * checkout, local or remote.
 *
 * @param runner - Where the repository lives.
 * @param root - Repository directory.
 * @param relativePath - Path from the project settings.
 * @returns The absolute real path.
 * @throws {PathOutsideWorkspaceError} When the path is missing or a symlink points outside
 *   the root.
 */
export async function resolveInsideWorkspace(
  runner: CommandRunner,
  root: string,
  relativePath: string,
): Promise<string> {
  const candidate = posix.resolve(root, relativePath);
  // BusyBox has neither `realpath -e` nor `--`; both paths are absolute, so neither is needed.
  const result = await runner(
    ["sh", "-c", 'test -e "$2" && realpath "$1" "$2"', "sh", root, candidate],
    { timeoutInMs: COMMAND_TIMEOUT_IN_MS },
  );
  const [realRoot, realCandidate] = result.stdout.split("\n");
  if (result.exitCode !== 0 || realRoot == null || realCandidate == null || realCandidate === "") {
    throw new PathOutsideWorkspaceError(`${relativePath} (not found)`);
  }
  const fromRoot = posix.relative(realRoot, realCandidate);
  if (fromRoot.startsWith("..") || posix.isAbsolute(fromRoot)) {
    throw new PathOutsideWorkspaceError(relativePath);
  }
  return realCandidate;
}

/** A temporary directory for one deployment, removed when disposed. */
export class DeploymentWorkspace implements AsyncDisposable {
  readonly path: string;
  readonly #runner: CommandRunner;

  private constructor(runner: CommandRunner, path: string) {
    this.#runner = runner;
    this.path = path;
  }

  /**
   * Creates a fresh directory under the workspace root, on the server the runner reaches.
   *
   * @param runner - Where the deployment builds.
   * @param workspaceRoot - Workspace directory on that server.
   * @param prefix - Readable prefix, such as the project slug.
   * @returns The workspace.
   * @throws {WorkspaceCommandError} When the directory cannot be created.
   */
  static async create(
    runner: CommandRunner,
    workspaceRoot: string,
    prefix: string,
  ): Promise<DeploymentWorkspace> {
    await runChecked(runner, ["mkdir", "-p", "--", workspaceRoot]);
    const output = await runChecked(runner, [
      "mktemp",
      "-d",
      "--",
      posix.join(workspaceRoot, `${prefix}-XXXXXXXX`),
    ]);
    const path = output.trim();
    if (path === "") {
      throw new WorkspaceCommandError("mktemp printed no directory");
    }
    return new DeploymentWorkspace(runner, path);
  }

  /** Directory the repository is cloned into. */
  get repositoryPath(): string {
    return posix.join(this.path, "repository");
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await runChecked(this.#runner, ["rm", "-rf", "--", this.path], REMOVE_TIMEOUT_IN_MS);
  }
}
