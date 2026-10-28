import { describe, expect, test } from "bun:test";

import { niceUpperBound, summarizeMetricPoints } from "./metric-chart";

describe("niceUpperBound", () => {
  test("adds headroom above the highest sample", () => {
    expect(
      niceUpperBound([
        { createdAt: "a", value: 80 },
        { createdAt: "b", value: 40 },
      ]),
    ).toBe(100);
  });

  test("ignores missing samples", () => {
    expect(
      niceUpperBound([
        { createdAt: "a", value: null },
        { createdAt: "b", value: 8 },
      ]),
    ).toBe(10);
  });

  test("returns a positive bound for an all-zero or empty series", () => {
    expect(niceUpperBound([{ createdAt: "a", value: 0 }])).toBe(1);
    expect(niceUpperBound([])).toBe(1);
  });
});

describe("summarizeMetricPoints", () => {
  test("returns the last and the highest measured values", () => {
    const summary = summarizeMetricPoints([
      { createdAt: "a", value: 10 },
      { createdAt: "b", value: 42 },
      { createdAt: "c", value: 8 },
    ]);

    expect(summary).toEqual({ latest: 8, max: 42 });
  });

  test("skips missing and non-finite values", () => {
    const summary = summarizeMetricPoints([
      { createdAt: "a", value: 5 },
      { createdAt: "b", value: Number.NaN },
      { createdAt: "c", value: null },
    ]);

    expect(summary).toEqual({ latest: 5, max: 5 });
  });

  test("returns null without any measured value", () => {
    const summary = summarizeMetricPoints([{ createdAt: "a", value: null }]);

    expect(summary).toBeNull();
  });
});
