import { describe, expect, test } from "bun:test";

import { parseTimestampedLine } from "./container-observer";

const FALLBACK = new Date("2026-10-28T00:00:00.000Z");

describe("parseTimestampedLine", () => {
  test("splits docker's nanosecond timestamp from the message", () => {
    const parsed = parseTimestampedLine("2026-10-28T13:45:01.123456789Z GET /health 200", FALLBACK);

    expect(parsed).toEqual({ createdAt: "2026-10-28T13:45:01.123Z", message: "GET /health 200" });
  });

  test("uses the fallback time for a line without timestamp", () => {
    expect(parseTimestampedLine("plain line", FALLBACK)).toEqual({
      createdAt: FALLBACK.toISOString(),
      message: "plain line",
    });
  });
});
