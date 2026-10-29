import { describe, expect, test } from "bun:test";

import { formatPercent } from "@/shared/format";

import { formatCurrentResource, resourceChart } from "./resource-series";

const SAMPLE = {
  createdAt: "2026-10-28T12:00:00Z",
  cpuPercent: 42.4,
  memoryUsedBytes: 2_097_152,
};

describe("formatCurrentResource", () => {
  test("returns a dash when there is no sample", () => {
    const value = formatCurrentResource("cpu", null);

    expect(value).toBe("—");
  });

  test("formats the cpu percent for the cpu series", () => {
    const value = formatCurrentResource("cpu", SAMPLE);

    expect(value).toBe(formatPercent(42.4));
  });

  test("formats the memory bytes for the memory series", () => {
    const value = formatCurrentResource("memory", SAMPLE);

    expect(value).toBe("2 MB");
  });
});

describe("resourceChart", () => {
  test("caps the cpu chart at 100 percent", () => {
    const chart = resourceChart("cpu", [SAMPLE]);

    expect(Object.hasOwn(chart, "maxValue")).toBe(true);
    expect(chart.points).toEqual([{ createdAt: SAMPLE.createdAt, value: 42.4 }]);
  });

  test("rounds cpu values in labels", () => {
    const chart = resourceChart("cpu", [SAMPLE]);

    expect(chart.formatValue(42.6)).toBe("43%");
  });

  test("converts memory samples to mebibytes without a fixed ceiling", () => {
    const chart = resourceChart("memory", [SAMPLE]);

    expect(Object.hasOwn(chart, "maxValue")).toBe(false);
    expect(chart.points).toEqual([{ createdAt: SAMPLE.createdAt, value: 2 }]);
  });
});
