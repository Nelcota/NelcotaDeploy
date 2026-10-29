import { InvalidRemoteCommandError } from "./remote.errors";

const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** First line the script writes to stderr, so the caller learns which process to stop. */
const PID_MARKER = "NELCOTA_PID";
const PID_LINE_PATTERN = new RegExp(`^${PID_MARKER} (\\d+)$`);
/** Exit code of the script when the working directory does not exist. */
const MISSING_DIRECTORY_EXIT_CODE = 125;

/**
 * Quotes a value for a POSIX shell. Inside single quotes nothing is special, so the only
 * character to handle is the single quote itself.
 *
 * @param value - Any text.
 * @returns The value as one shell word.
 * @throws {InvalidRemoteCommandError} When the value contains a NUL byte, which no shell
 *   argument can hold.
 */
export function quoteForShell(value: string): string {
  if (value.includes("\0")) {
    throw new InvalidRemoteCommandError("Shell arguments cannot contain NUL bytes");
  }
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Builds the shell script that runs one command on a remote server.
 *
 * @remarks
 * The script travels on the SSH channel's stdin, never in the command line, so environment
 * values (secrets included) do not show up in the remote process list. The command replaces
 * the shell with `exec`, keeping the reported process id valid for stopping it later.
 *
 * @param input - The `command` vector, extra `env` variables and an optional `cwd`.
 * @returns Script text for `sh -s`.
 * @throws {InvalidRemoteCommandError} When the command is empty, a variable name is invalid
 *   or a value contains a NUL byte.
 */
export function buildRemoteScript(input: {
  readonly command: readonly string[];
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly cwd?: string | undefined;
}): string {
  if (input.command.length === 0) {
    throw new InvalidRemoteCommandError("Cannot run an empty command");
  }
  const lines = [`printf '${PID_MARKER} %s\\n' "$$" >&2`];
  for (const [key, value] of Object.entries(input.env ?? {})) {
    if (ENVIRONMENT_KEY_PATTERN.test(key) === false) {
      throw new InvalidRemoteCommandError(`Invalid environment variable name: ${key}`);
    }
    lines.push(`export ${key}=${quoteForShell(value)}`);
  }
  if (input.cwd != null) {
    lines.push(`cd -- ${quoteForShell(input.cwd)} || exit ${MISSING_DIRECTORY_EXIT_CODE}`);
  }
  lines.push(`exec ${input.command.map((argument) => quoteForShell(argument)).join(" ")}`);
  return `${lines.join("\n")}\n`;
}

/**
 * Reads the process id from the script's first stderr line.
 *
 * @param line - A stderr line.
 * @returns The process id, or null when the line is ordinary output.
 */
export function parsePidLine(line: string): number | null {
  const match = PID_LINE_PATTERN.exec(line);
  if (match?.[1] == null) {
    return null;
  }
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 1 ? pid : null;
}
