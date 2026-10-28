import { classifyLogLevel, type LogLevel } from "@/shared/log-level";

/** Which lines a log view shows: everything, only warnings or only errors. */
export type LogLevelFilter = "all" | "warn" | "error";

type FilterableLine = { readonly message: string; readonly level?: LogLevel };

/** Longest search accepted; a longer one would only slow down the filter. */
const MAX_SEARCH_LENGTH = 200;

/**
 * Severity of a line: the one sent by the server, or a guess from its text.
 *
 * @param line - Log line.
 * @returns The severity.
 */
export function levelOf(line: FilterableLine): LogLevel {
  return line.level ?? classifyLogLevel(line.message);
}

function passesLevel(level: LogLevel, filter: LogLevelFilter): boolean {
  return filter === "all" || level === filter;
}

/**
 * Keeps the lines worth showing: drops blank lines, then applies the level filter and a
 * case-insensitive text search.
 *
 * @param lines - Lines in arrival order.
 * @param options - `search` is the text typed by the user (blank matches every line);
 * `level` keeps every line or only the lines of that severity.
 * @returns The matching lines, in the same order.
 */
export function filterLogLines<Line extends FilterableLine>(
  lines: readonly Line[],
  options: { readonly search: string; readonly level: LogLevelFilter },
): Line[] {
  const needle = options.search.trim().slice(0, MAX_SEARCH_LENGTH).toLowerCase();
  // Blank lines (common in BuildKit output) only add noise to the view.
  return lines.filter(
    (line) =>
      line.message.trim() !== "" &&
      passesLevel(levelOf(line), options.level) &&
      (needle === "" || line.message.toLowerCase().includes(needle)),
  );
}

/**
 * Counts the warning and error lines.
 *
 * @param lines - Lines to count.
 * @returns How many lines are warnings and how many are errors.
 */
export function countLogLevels(lines: readonly FilterableLine[]): {
  readonly warnings: number;
  readonly errors: number;
} {
  let warnings = 0;
  let errors = 0;
  for (const line of lines) {
    const level = levelOf(line);
    if (level === "warn") {
      warnings += 1;
    }
    if (level === "error") {
      errors += 1;
    }
  }
  return { warnings, errors };
}
