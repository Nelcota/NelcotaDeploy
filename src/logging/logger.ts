import pino from "pino";

import { getConfig } from "@/config";

/** Paths that pino replaces with "[REDACTED]" wherever they appear in a log object. */
const REDACTED_PATHS = [
  "password",
  "token",
  "secret",
  "value",
  "*.password",
  "*.token",
  "*.secret",
  "*.value",
  "headers.authorization",
  "headers.cookie",
];

let rootLogger: pino.Logger | undefined;

/**
 * Returns a structured logger for a process component.
 *
 * @param component - Name added to every line, such as "worker" or "web".
 * @returns A pino child logger.
 */
export function createLogger(component: string): pino.Logger {
  const config = getConfig();
  rootLogger ??= pino(
    {
      level: config.LOG_LEVEL,
      redact: { paths: REDACTED_PATHS, censor: "[REDACTED]" },
      base: { pid: process.pid },
    },
    pino.destination(config.LOG_STREAM === "stderr" ? 2 : 1),
  );
  return rootLogger.child({ component });
}

/**
 * Removes line breaks from untrusted text before it goes into a log line.
 *
 * @param text - Text that may come from a user or an external system.
 * @returns The text on a single line.
 */
export function singleLine(text: string): string {
  return text.replaceAll(/[\r\n]+/g, " ");
}
