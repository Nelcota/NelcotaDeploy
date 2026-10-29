import { describe, expect, test } from "bun:test";

import { formatPercent, usageTone } from "./usage-tone";

describe("usageTone", () => {
  test("is default when the usage is unknown", () => {
    expect(usageTone(null)).toBe("default");
  });

  test("is default just below the warning threshold", () => {
    expect(usageTone(74.9)).toBe("default");
  });

  test("is a warning from 75%", () => {
    expect(usageTone(75)).toBe("warning");
  });

  test("is danger from 90%", () => {
    expect(usageTone(90)).toBe("danger");
  });
});

describe("formatPercent", () => {
  test("shows a dash when the usage is unknown", () => {
    expect(formatPercent(null)).toBe("—");
  });

  test("rounds to a whole percentage", () => {
    expect(formatPercent(42.6)).toBe("43%");
  });
});
