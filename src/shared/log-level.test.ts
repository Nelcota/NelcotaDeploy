import { describe, expect, test } from "bun:test";

import { classifyLogLevel, type LogLevel } from "./log-level";

describe("classifyLogLevel", () => {
  test.each<[string, LogLevel]>([
    ["ERROR: failed to solve", "error"],
    ["npm WARN deprecated package", "warn"],
    ["#5 [2/4] RUN bun install", "info"],
    ["errors-handler.js loaded", "info"],
  ])("classifies %p as %p", (line, level) => {
    expect(classifyLogLevel(line)).toBe(level);
  });
});
