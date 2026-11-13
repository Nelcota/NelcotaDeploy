import { posix } from "node:path";

import { type CommandRunner, failureReason, type ProcessResult } from "@/process";

import { BuildPathError, PathOutsideWorkspaceError, WorkspaceCommandError } from "../worker.errors";

const COMMAND_TIMEOUT_IN_MS = 30_000;
// Deleting a large checkout with node_modules can take a while on a slow disk.
const REMOVE_TIMEOUT_IN_MS = 120_000;
const PATH_NOT_FOUND_EXIT_CODE = 44;
const PATH_LINE_SUFFIX = ".";
// Preserve realpath's trailing newline through command substitution. Mark each output line
// so CR in a path cannot be mistaken for the CR in a normal CRLF line ending by the runner.
const RESOLVE_PATHS_SCRIPT = [
  `[ -e "$2" ] || exit ${PATH_NOT_FOUND_EXIT_CODE}`,
  'paths=$(realpath "$1" "$2" && printf ".") || exit "$?"',
  'printf "%s" "${paths%.}" | sed "s/$/./"',
].join("\n");

function containsPathDelimiter(path: string): boolean {
  return path.includes("\0") || path.includes("\r") || path.includes("\n");
}

/** Checks whether an absolute path is lexically inside an absolute workspace root. */
export function isPathInsideWorkspace(root: string, path: string): boolean {
  if (
    posix.isAbsolute(root) === false ||
    posix.isAbsolute(path) === false ||
    containsPathDelimiter(root) ||
    containsPathDelimiter(path)
  ) {
    return false;
  }

  const relative = posix.relative(root, path);
  return (
    relative !== ".." &&
    relative.startsWith("../") === false &&
    posix.isAbsolute(relative) === false
  );
}

function parseResolvedPaths(output: string): readonly [string, string] {
  const lines = output.split("\n");
  const [root, candidate, end] = lines;
  if (
    lines.length !== 3 ||
    end !== "" ||
    root?.endsWith(PATH_LINE_SUFFIX) !== true ||
    candidate?.endsWith(PATH_LINE_SUFFIX) !== true
  ) {
    throw new WorkspaceCommandError("realpath returned invalid path output");
  }

  const realRoot = root.slice(0, -1);
  const realCandidate = candidate.slice(0, -1);
  if (
    posix.isAbsolute(realRoot) === false ||
    posix.isAbsolute(realCandidate) === false ||
    containsPathDelimiter(realRoot) ||
    containsPathDelimiter(realCandidate)
  ) {
    throw new WorkspaceCommandError("realpath returned an invalid absolute path");
  }

  return [realRoot, realCandidate];
}

async function runChecked(
  runner: CommandRunner,
  command: readonly string[],
  timeoutInMs: number = COMMAND_TIMEOUT_IN_MS,
): Promise<string> {
  const result: ProcessResult = await runner(command, { timeoutInMs });
  if (result.exitCode !== 0 || result.timedOut || result.aborted) {
    throw new WorkspaceCommandError(`${command[0] ?? ""} failed: ${failureReason(result)}`);
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
 * @throws {WorkspaceCommandError} When path resolution fails or returns invalid output.
 */
export async function resolveInsideWorkspace(
  runner: CommandRunner,
  root: string,
  relativePath: string,
): Promise<string> {
  if (posix.isAbsolute(root) === false || containsPathDelimiter(root)) {
    throw new WorkspaceCommandError("the repository root must be an absolute single-line path");
  }

  if (
    relativePath.trim() === "" ||
    posix.isAbsolute(relativePath) ||
    containsPathDelimiter(relativePath)
  ) {
    throw new PathOutsideWorkspaceError(relativePath);
  }

  const candidate = posix.resolve(root, relativePath);
  if (isPathInsideWorkspace(root, candidate) === false) {
    throw new PathOutsideWorkspaceError(relativePath);
  }

  const result = await runner(["sh", "-c", RESOLVE_PATHS_SCRIPT, "sh", root, candidate], {
    timeoutInMs: COMMAND_TIMEOUT_IN_MS,
  });
  if (result.timedOut || result.aborted) {
    throw new WorkspaceCommandError(`realpath ${failureReason(result)}`);
  }

  if (result.exitCode === PATH_NOT_FOUND_EXIT_CODE) {
    throw new PathOutsideWorkspaceError(`${relativePath} (not found)`);
  }

  if (result.exitCode !== 0) {
    throw new WorkspaceCommandError(`realpath exited with code ${result.exitCode}`);
  }

  const [realRoot, realCandidate] = parseResolvedPaths(result.stdout);
  if (isPathInsideWorkspace(realRoot, realCandidate) === false) {
    throw new PathOutsideWorkspaceError(relativePath);
  }

  return realCandidate;
}

/** Resolves a path selected in the project's build settings. */
export async function resolveBuildPath(
  runner: CommandRunner,
  root: string,
  relativePath: string,
): Promise<string> {
  try {
    return await resolveInsideWorkspace(runner, root, relativePath);
  } catch (error) {
    if (error instanceof PathOutsideWorkspaceError) {
      throw new BuildPathError(error);
    }

    throw error;
  }
}

/** Called when the workspace could not be removed; the deployment itself goes on. */
type CleanupErrorHandler = (message: string) => void;

/** A temporary directory for one deployment, removed when disposed. */
export class DeploymentWorkspace implements AsyncDisposable {
  readonly path: string;
  readonly #runner: CommandRunner;
  readonly #onCleanupError: CleanupErrorHandler;

  private constructor(runner: CommandRunner, path: string, onCleanupError: CleanupErrorHandler) {
    this.#runner = runner;
    this.path = path;
    this.#onCleanupError = onCleanupError;
  }

  /**
   * Creates a fresh directory under the workspace root, on the server the runner reaches.
   *
   * @param runner - Where the deployment builds.
   * @param location - The `root` workspace directory on that server, a readable `prefix`
   *   such as the project slug, and `onCleanupError`, told when removal fails later.
   * @returns The workspace.
   * @throws {WorkspaceCommandError} When the directory cannot be created.
   */
  static async create(
    runner: CommandRunner,
    location: {
      readonly root: string;
      readonly prefix: string;
      readonly onCleanupError: CleanupErrorHandler;
    },
  ): Promise<DeploymentWorkspace> {
    const { root: workspaceRoot, prefix } = location;
    if (
      posix.isAbsolute(workspaceRoot) === false ||
      containsPathDelimiter(workspaceRoot) ||
      prefix.trim() === "" ||
      containsPathDelimiter(prefix) ||
      prefix.includes("/") ||
      prefix.includes("\\")
    ) {
      throw new WorkspaceCommandError("invalid workspace root or directory prefix");
    }

    await runChecked(runner, ["mkdir", "-p", "--", workspaceRoot]);
    const output = await runChecked(runner, [
      "mktemp",
      "-d",
      "--",
      posix.join(workspaceRoot, `${prefix}-XXXXXXXX`),
    ]);
    const path = output.endsWith("\n") ? output.slice(0, -1) : output;
    if (
      containsPathDelimiter(path) ||
      posix.isAbsolute(path) === false ||
      posix.dirname(path) !== posix.resolve(workspaceRoot) ||
      posix.basename(path).startsWith(`${prefix}-`) === false
    ) {
      throw new WorkspaceCommandError("mktemp returned an invalid workspace directory");
    }

    return new DeploymentWorkspace(runner, path, location.onCleanupError);
  }

  /** Directory the repository is cloned into. */
  get repositoryPath(): string {
    return posix.join(this.path, "repository");
  }

  /**
   * Removes the directory. A failure is reported, never thrown: it must not fail a deployment
   * whose image was built, nor hide the real error of one that failed.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    try {
      await runChecked(this.#runner, ["rm", "-rf", "--", this.path], REMOVE_TIMEOUT_IN_MS);
    } catch (error) {
      this.#onCleanupError(error instanceof Error ? error.message : String(error));
    }
  }
}
