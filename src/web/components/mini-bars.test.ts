import { describe, expect, test } from "bun:test";

import { barHeights, blockCounts, bucketAverages, bucketCounts } from "./mini-bars";

const NOW = new Date("2026-10-28T12:00:00Z");
const DAY_IN_MS = 86_400_000;

describe("bucketCounts", () => {
  test("puts events in their bucket, oldest first", () => {
    const dates = ["2026-10-28T11:30:00Z", "2026-10-28T11:59:00Z", "2026-10-27T13:00:00Z"];

    const counts = bucketCounts(dates, NOW, DAY_IN_MS, 4);

    expect(counts).toEqual([1, 0, 0, 2]);
  });

  test("ignores events outside the window and in the future", () => {
    const dates = ["2026-10-27T11:00:00Z", "2026-10-28T13:00:00Z"];

    const counts = bucketCounts(dates, NOW, DAY_IN_MS, 4);

    expect(counts).toEqual([0, 0, 0, 0]);
  });

  test("ignores invalid dates", () => {
    const counts = bucketCounts(["not a date"], NOW, DAY_IN_MS, 2);

    expect(counts).toEqual([0, 0]);
  });

  test("returns zeros for an empty list", () => {
    const counts = bucketCounts([], NOW, DAY_IN_MS, 3);

    expect(counts).toEqual([0, 0, 0]);
  });

  test("throws RangeError when the bucket count is zero", () => {
    expect(() => bucketCounts([], NOW, DAY_IN_MS, 0)).toThrow(RangeError);
  });

  test("throws RangeError when the window is not finite", () => {
    expect(() => bucketCounts([], NOW, Number.NaN, 2)).toThrow(RangeError);
  });

  test("throws RangeError when the window is negative", () => {
    expect(() => bucketCounts([], NOW, -1, 2)).toThrow(RangeError);
  });
});

describe("bucketAverages", () => {
  test("averages values per bucket and leaves empty buckets null", () => {
    const points = [
      { createdAt: "2026-10-28T11:50:00Z", value: 20 },
      { createdAt: "2026-10-28T11:55:00Z", value: 40 },
    ];

    const averages = bucketAverages(points, NOW, DAY_IN_MS, 2);

    expect(averages).toEqual([null, 30]);
  });

  test("ignores null and non-finite values", () => {
    const points = [
      { createdAt: "2026-10-28T11:50:00Z", value: null },
      { createdAt: "2026-10-28T11:55:00Z", value: Number.POSITIVE_INFINITY },
    ];

    const averages = bucketAverages(points, NOW, DAY_IN_MS, 1);

    expect(averages).toEqual([null]);
  });

  test("throws RangeError when the bucket count is not an integer", () => {
    expect(() => bucketAverages([], NOW, DAY_IN_MS, 1.5)).toThrow(RangeError);
  });
});

describe("barHeights", () => {
  test("scales bars against the tallest value", () => {
    const heights = barHeights([5, 10]);

    expect(heights).toEqual([50, 100]);
  });

  test("keeps a stub for zero and missing values", () => {
    const heights = barHeights([0, null, 4]);

    expect(heights).toEqual([6, 6, 100]);
  });

  test("keeps a stub for every bar when all values are zero", () => {
    const heights = barHeights([0, 0]);

    expect(heights).toEqual([6, 6]);
  });

  test("never draws a tiny value below the stub height", () => {
    const heights = barHeights([1, 1000]);

    expect(heights[0]).toBe(6);
  });
});

describe("blockCounts", () => {
  test("keeps one block per item up to the limit", () => {
    const blocks = blockCounts(3, 5, 12);

    expect(blocks).toEqual({ filled: 3, total: 5 });
  });

  test("scales the ratio when there are more items than blocks", () => {
    const blocks = blockCounts(12, 24, 12);

    expect(blocks).toEqual({ filled: 6, total: 12 });
  });

  test("draws nothing when there are no items", () => {
    const blocks = blockCounts(0, 0, 12);

    expect(blocks).toEqual({ filled: 0, total: 0 });
  });

  test("throws RangeError when filled exceeds total", () => {
    expect(() => blockCounts(3, 2, 12)).toThrow(RangeError);
  });

  test("throws RangeError when total is negative", () => {
    expect(() => blockCounts(0, -1, 12)).toThrow(RangeError);
  });

  test("throws RangeError when the block limit is zero", () => {
    expect(() => blockCounts(0, 1, 0)).toThrow(RangeError);
  });
});
