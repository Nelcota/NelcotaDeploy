import { describe, expect, test } from "bun:test";

import { formatBytes, formatDateTime, formatDuration, formatPercent } from "./format";

describe("format", () => {
  test("formats dates in São Paulo time", () => {
    expect(formatDateTime("2026-10-24T14:30:00Z")).toBe("24/10/2026, 11:30:00");
  });

  test("shows a dash for invalid dates", () => {
    expect(formatDateTime("not a date")).toBe("—");
  });

  test("formats durations in minutes and seconds", () => {
    expect(formatDuration(65_000)).toBe("1 min 05 s");
    expect(formatDuration(850)).toBe("850 ms");
  });

  test.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("shows a dash for duration %p", (value) => {
    expect(formatDuration(value)).toBe("—");
  });

  test("formats bytes with binary units", () => {
    expect(formatBytes(1536)).toBe("1,5 KB");
  });

  test("shows a dash for unavailable percentages instead of zero", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(42.5)).toBe("42,5%");
  });
});
