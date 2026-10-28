import { describe, expect, test } from "bun:test";

import { cpuPercentBetween, parseMeminfo, parseProcStat } from "./host-metrics";

describe("parseProcStat", () => {
  test("sums idle and iowait as idle time", () => {
    const text = "cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 2 3 4 5 6 7 8 9 10\n";

    const times = parseProcStat(text);

    expect(times).toEqual({ idle: 850, total: 1000 });
  });

  test("returns null when the aggregate line is missing", () => {
    expect(parseProcStat("intr 1 2 3")).toBeNull();
  });
});

describe("cpuPercentBetween", () => {
  test("computes busy time over elapsed time", () => {
    const percent = cpuPercentBetween({ idle: 850, total: 1000 }, { idle: 1000, total: 1200 });

    expect(percent).toBe(25);
  });

  test("returns null when no time elapsed instead of inventing a value", () => {
    expect(cpuPercentBetween({ idle: 1, total: 10 }, { idle: 1, total: 10 })).toBeNull();
  });
});

describe("parseMeminfo", () => {
  test("reports used memory as total minus available", () => {
    const text = "MemTotal:       2048 kB\nMemFree:         100 kB\nMemAvailable:    1024 kB\n";

    const memory = parseMeminfo(text);

    expect(memory).toEqual({ totalBytes: 2048 * 1024, usedBytes: 1024 * 1024 });
  });

  test("returns null when MemAvailable is missing", () => {
    expect(parseMeminfo("MemTotal: 2048 kB\n")).toBeNull();
  });
});
