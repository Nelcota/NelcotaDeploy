import { useEffect, useState } from "react";

import type { LogLevel } from "@/shared/log-level";

/** One line received from a log stream. */
export type LogLine = {
  readonly id: number;
  readonly message: string;
  readonly createdAt: string;
  readonly stream: string;
  readonly level?: LogLevel;
};

/** Where the connection to the log stream stands. */
export type ConnectionState = "connecting" | "live" | "reconnecting" | "ended" | "error";

/** Lines kept in memory; older ones are dropped as new ones arrive. */
const MAX_LINES = 5000;

/**
 * Adds a line at the end, dropping the oldest ones beyond the limit.
 *
 * @param lines - Lines received so far, oldest first.
 * @param line - New line.
 * @param maxLines - Most lines to keep. Must be a positive integer.
 * @returns The new list, at most `maxLines` long.
 * @throws {RangeError} When `maxLines` is not a positive integer.
 */
export function appendLogLine<Line>(lines: readonly Line[], line: Line, maxLines: number): Line[] {
  if (Number.isInteger(maxLines) === false || maxLines < 1) {
    throw new RangeError(`maxLines must be a positive integer, received ${maxLines}`);
  }
  const kept = lines.length >= maxLines ? lines.slice(lines.length - maxLines + 1) : lines;
  return [...kept, line];
}

/**
 * Subscribes to a server-sent log stream. EventSource reconnects by itself and sends the
 * last received id, so the server resumes exactly where the stream stopped.
 *
 * @param url - Stream address.
 * @param attempt - Bumped by the user to open a fresh connection after an error.
 * @returns The received lines, the connection state and the summary sent with "end".
 */
export function useLogStream(url: string, attempt: number) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [endSummary, setEndSummary] = useState<unknown>(null);
  // A new url or a retry starts a fresh stream; resetting during render avoids showing the
  // previous stream's lines for one frame, as React recommends over resetting in an effect.
  const streamKey = `${attempt}:${url}`;
  const [activeStreamKey, setActiveStreamKey] = useState(streamKey);
  if (streamKey !== activeStreamKey) {
    setActiveStreamKey(streamKey);
    setLines([]);
    setState("connecting");
    setEndSummary(null);
  }

  useEffect(() => {
    const source = new EventSource(url, { withCredentials: true });
    source.addEventListener("open", () => setState("live"));
    source.addEventListener("log", (event) => {
      const line = JSON.parse(event.data as string) as LogLine;
      setLines((current) => appendLogLine(current, line, MAX_LINES));
    });
    source.addEventListener("end", (event) => {
      setEndSummary(JSON.parse(event.data as string));
      setState("ended");
      source.close();
    });
    source.addEventListener("error", () => {
      setState(source.readyState === EventSource.CLOSED ? "error" : "reconnecting");
    });
    return () => source.close();
  }, [url, attempt]);

  return { lines, state, endSummary };
}
