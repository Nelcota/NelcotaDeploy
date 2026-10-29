import { type CommandRunner, failureReason } from "@/process";

import type { DynamicConfig } from "./route-config";
import { InvalidRouteError, RouteFileError } from "./routing.errors";

const FILE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ABSOLUTE_PATH_PATTERN = /^\/[A-Za-z0-9._/-]*$/;
const COMMAND_TIMEOUT_IN_MS = 15_000;
/** Name of the file with the middlewares every route uses. */
const SHARED_FILE = "shared";
// Writes beside the target and renames it into place, so the proxy, which watches the
// directory, never reads half a file. The content travels as an argument, never as code.
const ATOMIC_WRITE_SCRIPT =
  'mkdir -p "$1" && printf "%s" "$3" > "$1/.$2.tmp" && mv -f "$1/.$2.tmp" "$1/$2"';

/**
 * The directory of route files the proxy of one server watches, reached through that server's
 * command runner, so the same code writes locally and over SSH.
 *
 * @remarks
 * Files are JSON, which is valid YAML, under a `.yml` name the proxy loads.
 */
export class RouteFiles {
  readonly #runner: CommandRunner;
  readonly #directory: string;

  /**
   * Points at the route directory of one server.
   *
   * @param runner - Runs commands on the server whose proxy reads the files.
   * @param directory - Absolute path of the directory the proxy watches.
   * @throws {InvalidRouteError} When the directory is not an absolute path.
   */
  constructor(runner: CommandRunner, directory: string) {
    if (ABSOLUTE_PATH_PATTERN.test(directory) === false || directory.includes("..")) {
      throw new InvalidRouteError(`Invalid route directory: ${JSON.stringify(directory)}`);
    }
    this.#runner = runner;
    this.#directory = directory;
  }

  /**
   * Replaces the routes stored under a name, atomically.
   *
   * @param name - File name without extension, such as a project id.
   * @param config - Dynamic configuration to store.
   * @throws {InvalidRouteError} When the name could leave the directory.
   * @throws {RouteFileError} When the file cannot be written.
   */
  async write(name: string, config: DynamicConfig): Promise<void> {
    const result = await this.#runner(
      [
        "sh",
        "-c",
        ATOMIC_WRITE_SCRIPT,
        "sh",
        this.#directory,
        fileName(name),
        JSON.stringify(config),
      ],
      { timeoutInMs: COMMAND_TIMEOUT_IN_MS },
    );
    if (result.exitCode !== 0) {
      throw new RouteFileError(`Could not write routes ${name}: ${failureReason(result)}`);
    }
  }

  /**
   * Stores the middlewares shared by every route of the server.
   *
   * @param config - Shared dynamic configuration.
   * @throws {RouteFileError} When the file cannot be written.
   */
  async writeShared(config: DynamicConfig): Promise<void> {
    await this.write(SHARED_FILE, config);
  }

  /**
   * Removes the routes stored under a name; nothing happens when there are none.
   *
   * @param name - File name without extension.
   * @throws {InvalidRouteError} When the name could leave the directory.
   * @throws {RouteFileError} When the file cannot be removed.
   */
  async remove(name: string): Promise<void> {
    const result = await this.#runner(["rm", "-f", "--", `${this.#directory}/${fileName(name)}`], {
      timeoutInMs: COMMAND_TIMEOUT_IN_MS,
    });
    if (result.exitCode !== 0) {
      throw new RouteFileError(`Could not remove routes ${name}: ${failureReason(result)}`);
    }
  }
}

function fileName(name: string): string {
  if (FILE_NAME_PATTERN.test(name) === false) {
    throw new InvalidRouteError(`Invalid route file name: ${JSON.stringify(name)}`);
  }
  return `${name}.yml`;
}
