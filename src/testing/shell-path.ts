/**
 * Converts a native test path into the POSIX path Git for Windows exposes to shell commands.
 *
 * @param path - Nonempty path of a test fixture.
 * @param platform - Host platform; injectable for cross-platform tests.
 * @returns A shell-readable path, unchanged on POSIX hosts.
 * @throws {RangeError} When the path is empty.
 */
export function toShellPath(path: string, platform: NodeJS.Platform = process.platform): string {
  if (path.trim() === "") {
    throw new RangeError("Test path cannot be empty");
  }
  if (platform !== "win32") {
    return path;
  }
  const normalized = path.replaceAll("\\", "/");
  const drive = /^([A-Za-z]):/.exec(normalized)?.[1];
  return drive == null ? normalized : `/${drive.toLowerCase()}${normalized.slice(2)}`;
}

/**
 * Converts a Git-for-Windows shell path back into a path Bun's filesystem APIs can read.
 *
 * @param path - Nonempty shell path of a fixture.
 * @param platform - Host platform; injectable for cross-platform tests.
 * @returns A native filesystem path, unchanged on POSIX hosts.
 * @throws {RangeError} When the path is empty.
 */
export function fromShellPath(path: string, platform: NodeJS.Platform = process.platform): string {
  if (path.trim() === "") {
    throw new RangeError("Test path cannot be empty");
  }
  if (platform !== "win32") {
    return path;
  }
  const drive = /^\/([A-Za-z])(?:\/|$)/.exec(path)?.[1];
  return drive == null ? path : `${drive.toUpperCase()}:${path.slice(2)}`;
}
