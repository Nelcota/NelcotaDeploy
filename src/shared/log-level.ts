/** Severity shown with a log line. */
export type LogLevel = "info" | "warn" | "error";

const ERROR_PATTERN = /\b(error|failed|failure|fatal|panic|exception)\b/i;
const WARNING_PATTERN = /\b(warn|warning|deprecated)\b/i;

/**
 * Guesses a line's severity from its text.
 *
 * @remarks
 * Docker BuildKit and many apps write normal progress to stderr, so the stream alone
 * does not tell severity.
 *
 * @param line - Log line.
 * @returns The severity.
 */
export function classifyLogLevel(line: string): LogLevel {
  if (ERROR_PATTERN.test(line)) {
    return "error";
  }
  if (WARNING_PATTERN.test(line)) {
    return "warn";
  }
  return "info";
}
