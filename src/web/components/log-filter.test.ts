import { describe, expect, test } from "bun:test";

import { countLogLevels, filterLogLines, levelOf } from "./log-filter";

const LINES = [
  { message: "server listening on 3000" },
  { message: "   " },
  { message: "warning: config deprecated" },
  { message: "Error: connection refused" },
  { message: "request done", level: "error" as const },
];

describe("levelOf", () => {
  test("uses the level sent by the server", () => {
    const level = levelOf({ message: "all good", level: "warn" });

    expect(level).toBe("warn");
  });

  test("guesses the level from the text when none was sent", () => {
    const level = levelOf({ message: "fatal: out of memory" });

    expect(level).toBe("error");
  });
});

describe("filterLogLines", () => {
  test("keeps every non-blank line with no search and every level", () => {
    const result = filterLogLines(LINES, { search: "", level: "all" });

    expect(result.map((line) => line.message)).toEqual([
      "server listening on 3000",
      "warning: config deprecated",
      "Error: connection refused",
      "request done",
    ]);
  });

  test("keeps only warnings for the warn filter", () => {
    const result = filterLogLines(LINES, { search: "", level: "warn" });

    expect(result.map((line) => line.message)).toEqual(["warning: config deprecated"]);
  });

  test("keeps only errors for the error filter", () => {
    const result = filterLogLines(LINES, { search: "", level: "error" });

    expect(result.map((line) => line.message)).toEqual([
      "Error: connection refused",
      "request done",
    ]);
  });

  test("matches the search ignoring case and surrounding spaces", () => {
    const result = filterLogLines(LINES, { search: "  CONNECTION ", level: "all" });

    expect(result.map((line) => line.message)).toEqual(["Error: connection refused"]);
  });

  test("combines the search with the level filter", () => {
    const result = filterLogLines(LINES, { search: "server", level: "error" });

    expect(result).toEqual([]);
  });

  test("returns nothing for an empty list", () => {
    const result = filterLogLines([], { search: "", level: "all" });

    expect(result).toEqual([]);
  });
});

describe("countLogLevels", () => {
  test("counts warning and error lines", () => {
    const counts = countLogLevels(LINES);

    expect(counts).toEqual({ warnings: 1, errors: 2 });
  });

  test("counts zero for an empty list", () => {
    const counts = countLogLevels([]);

    expect(counts).toEqual({ warnings: 0, errors: 0 });
  });
});
