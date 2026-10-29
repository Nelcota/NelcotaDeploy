import { describe, expect, test } from "bun:test";

import { hostSeriesValue } from "./dashboard";

const SAMPLE = { cpuPercent: 12.5, memoryUsedBytes: 512, memoryTotalBytes: 2048 };

describe("hostSeriesValue", () => {
  test("reads CPU use for the cpu series", () => {
    const value = hostSeriesValue(SAMPLE, "cpu");

    expect(value).toBe(12.5);
  });

  test("reads memory use as a percentage for the memory series", () => {
    const value = hostSeriesValue(SAMPLE, "memory");

    expect(value).toBe(25);
  });

  test("returns null for CPU when there is no sample", () => {
    const value = hostSeriesValue(undefined, "cpu");

    expect(value).toBeNull();
  });
});
