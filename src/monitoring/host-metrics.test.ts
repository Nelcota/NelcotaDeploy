import { describe, expect, test } from "bun:test";

import { cpuPercentBetween, parseDiskUsage, parseMeminfo, parseProcStat } from "./host-metrics";

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

describe("parseDiskUsage", () => {
  test("reports used space as total minus what is available", () => {
    const text =
      "Filesystem     1024-blocks    Used Available Capacity Mounted on\n" +
      "/dev/vda1         1000000  400000    500000      45% /\n";

    const disk = parseDiskUsage(text);

    expect(disk).toEqual({ totalBytes: 1_000_000 * 1024, usedBytes: 500_000 * 1024 });
  });

  test("reads the data line when cpu and memory readings come first", () => {
    const text =
      "cpu  1 2 3 4 5\nMemTotal: 1 kB\nFilesystem 1024-blocks Used Available Capacity Mounted on\nfs 100 10 80 12% /\n";

    expect(parseDiskUsage(text)?.totalBytes).toBe(100 * 1024);
  });

  test.each([
    [""],
    ["Filesystem 1024-blocks Used Available Capacity Mounted on"],
    ["fs 0 0 0 0% /"],
  ])("returns null for %p", (text) => {
    expect(parseDiskUsage(text)).toBeNull();
  });
});
