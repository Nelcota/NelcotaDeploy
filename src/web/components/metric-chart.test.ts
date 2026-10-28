import { describe, expect, test } from "bun:test";

import { niceUpperBound } from "./metric-chart";

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
