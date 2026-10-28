import { describe, expect, test } from "bun:test";

import {
  bytesToMebibytes,
  dayKey,
  formatMebibytes,
  formatDayHeading,
  formatShortDay,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatLongDate,
  formatPercent,
  pluralize,
} from "./format";

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

  test("uses the singular only for exactly one", () => {
    expect(pluralize(1, "deploy", "deploys")).toBe("1 deploy");
    expect(pluralize(0, "deploy", "deploys")).toBe("0 deploys");
    expect(pluralize(3, "deploy", "deploys")).toBe("3 deploys");
  });

  test("formats a long date with weekday and month in São Paulo time", () => {
    expect(formatLongDate(new Date("2026-10-28T02:00:00Z"))).toBe("terça-feira, 27 de outubro");
  });
});

describe("dayKey", () => {
  test("uses the São Paulo calendar day", () => {
    const key = dayKey("2026-10-29T01:00:00Z");

    expect(key).toBe("2026-10-28");
  });

  test("returns null for an invalid date", () => {
    const key = dayKey("not a date");

    expect(key).toBeNull();
  });
});

describe("formatDayHeading", () => {
  const now = new Date("2026-10-28T15:00:00Z");

  test("names a date on the same day as today", () => {
    const heading = formatDayHeading("2026-10-28T03:30:00Z", now);

    expect(heading).toBe("Hoje");
  });

  test("names a date on the previous day as yesterday", () => {
    const heading = formatDayHeading("2026-10-28T02:00:00Z", now);

    expect(heading).toBe("Ontem");
  });

  test("spells out older dates", () => {
    const heading = formatDayHeading("2026-10-25T15:00:00Z", now);

    expect(heading).toBe("domingo, 25 de outubro");
  });

  test("returns a dash for an invalid date", () => {
    const heading = formatDayHeading("", now);

    expect(heading).toBe("—");
  });
});

describe("formatShortDay", () => {
  test("names the weekday and the day of month", () => {
    const label = formatShortDay("2026-10-26");

    expect(label).toBe("seg., 26");
  });

  test("returns a dash for a malformed key", () => {
    const label = formatShortDay("26/10/2026");

    expect(label).toBe("—");
  });

  test("returns a dash for an impossible date", () => {
    const label = formatShortDay("2026-13-40");

    expect(label).toBe("—");
  });
});

describe("bytesToMebibytes", () => {
  test("converts bytes to MiB", () => {
    expect(bytesToMebibytes(256 * 1024 * 1024)).toBe(256);
  });

  test.each([null, undefined, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "returns null for %p",
    (value) => {
      expect(bytesToMebibytes(value)).toBeNull();
    },
  );
});

describe("formatMebibytes", () => {
  test("formats MiB with the byte unit", () => {
    expect(formatMebibytes(240)).toBe("240 MB");
  });
});
