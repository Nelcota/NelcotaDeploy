import { describe, expect, test } from "bun:test";

import { formatCommandLine, parseCommandLine } from "./command-line";
import { CommandLineParseError } from "./command-line.errors";

describe("parseCommandLine", () => {
  test("splits words on whitespace", () => {
    expect(parseCommandLine("bun run  migrate")).toEqual(["bun", "run", "migrate"]);
  });

  test("keeps quoted text as one argument", () => {
    expect(parseCommandLine(`node -e 'console.log("hi there")'`)).toEqual([
      "node",
      "-e",
      'console.log("hi there")',
    ]);
  });

  test("treats shell operators as plain text", () => {
    expect(parseCommandLine("echo a; rm -rf / | cat $(id)")).toEqual([
      "echo",
      "a;",
      "rm",
      "-rf",
      "/",
      "|",
      "cat",
      "$(id)",
    ]);
  });

  test("keeps an empty quoted argument", () => {
    expect(parseCommandLine(`printf ''`)).toEqual(["printf", ""]);
  });

  test("returns an empty list for blank input", () => {
    expect(parseCommandLine("   ")).toEqual([]);
  });

  test("throws CommandLineParseError for an unterminated quote", () => {
    expect(() => parseCommandLine(`echo "oops`)).toThrow(CommandLineParseError);
  });

  test("throws CommandLineParseError for a trailing backslash", () => {
    expect(() => parseCommandLine("echo \\")).toThrow(CommandLineParseError);
  });
});

describe("formatCommandLine", () => {
  test("round-trips through parseCommandLine", () => {
    const args = ["node", "-e", "console.log('x y')", ""];

    expect(parseCommandLine(formatCommandLine(args))).toEqual(args);
  });
});
