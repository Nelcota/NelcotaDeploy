import { describe, expect, test } from "bun:test";

import { appendLogLine } from "@/web/components/monitoring/log-stream";

describe("appendLogLine", () => {
  test("adds the line at the end while under the limit", () => {
    const lines = appendLogLine(["a", "b"], "c", 3);

    expect(lines).toEqual(["a", "b", "c"]);
  });

  test("drops the oldest line when the limit is reached", () => {
    const lines = appendLogLine(["a", "b", "c"], "d", 3);

    expect(lines).toEqual(["b", "c", "d"]);
  });

  test("keeps only the new line with a limit of one", () => {
    const lines = appendLogLine(["a"], "b", 1);

    expect(lines).toEqual(["b"]);
  });

  test("throws RangeError when the limit is zero", () => {
    expect(() => appendLogLine([], "a", 0)).toThrow(RangeError);
  });

  test("throws RangeError when the limit is not an integer", () => {
    expect(() => appendLogLine([], "a", Number.NaN)).toThrow(RangeError);
  });
});
