import { describe, expect, test } from "bun:test";

import { parseTimestampedLine } from "./container-observer";

describe("parseTimestampedLine", () => {
  test("splits docker's nanosecond timestamp from the message", () => {
    const parsed = parseTimestampedLine("2026-10-28T13:45:01.123456789Z GET /health 200");

    expect(parsed).toEqual({ createdAt: "2026-10-28T13:45:01.123Z", message: "GET /health 200" });
  });

  test("returns null for a docker CLI message without timestamp", () => {
    const parsed = parseTimestampedLine(
      "error from daemon in stream: read unix @->/run/docker.sock: use of closed network connection",
    );

    expect(parsed).toBeNull();
  });

  test("returns null when the timestamp is not a valid date", () => {
    const parsed = parseTimestampedLine("2026-13-45T99:99:99Z message");

    expect(parsed).toBeNull();
  });

  test("keeps an empty message when the line is only a timestamp", () => {
    const parsed = parseTimestampedLine("2026-10-28T13:45:01Z");

    expect(parsed).toEqual({ createdAt: "2026-10-28T13:45:01.000Z", message: "" });
  });
});
