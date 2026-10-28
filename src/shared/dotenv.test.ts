import { describe, expect, test } from "bun:test";

import { normalizeVariableKey, parseDotenv } from "./dotenv";

describe("parseDotenv", () => {
  test("reads pairs and skips blank lines and comments", () => {
    const result = parseDotenv("# comment\n\nNODE_ENV=production\nPORT=3000\n");

    expect(result.entries).toEqual([
      { key: "NODE_ENV", value: "production" },
      { key: "PORT", value: "3000" },
    ]);
    expect(result.problems).toEqual([]);
  });

  test("strips export prefixes, quotes and inline comments", () => {
    const result = parseDotenv(`export A="hello world"\nB='x # y'\nC=plain # note`);

    expect(result.entries).toEqual([
      { key: "A", value: "hello world" },
      { key: "B", value: "x # y" },
      { key: "C", value: "plain" },
    ]);
  });

  test("keeps an equals sign inside the value", () => {
    expect(parseDotenv("URL=postgres://u:p@h/db?a=b").entries[0]?.value).toBe(
      "postgres://u:p@h/db?a=b",
    );
  });

  test("keeps the last value when a key repeats", () => {
    expect(parseDotenv("A=1\nA=2").entries).toEqual([{ key: "A", value: "2" }]);
  });

  test("reports lines without an equals sign and invalid or reserved names", () => {
    const result = parseDotenv("JUST_TEXT\n1BAD=x\nNELCOTA_X=y");

    expect(result.entries).toEqual([]);
    expect(result.problems.map((problem) => problem.line)).toEqual([1, 2, 3]);
  });

  test("returns nothing for empty input", () => {
    expect(parseDotenv("   ")).toEqual({ entries: [], problems: [] });
  });
});

describe("normalizeVariableKey", () => {
  test("uppercases and replaces spaces and dashes with underscores", () => {
    expect(normalizeVariableKey("api-key value")).toBe("API_KEY_VALUE");
  });

  test("drops characters that are not allowed", () => {
    expect(normalizeVariableKey("db.url!")).toBe("DBURL");
  });
});
