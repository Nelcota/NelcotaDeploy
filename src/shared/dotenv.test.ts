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

  test("preserves multiline quoted values without importing their contents as new variables", () => {
    const result = parseDotenv('PRIVATE_KEY="first\nSECOND=inside\nlast"\nPORT=3000');

    expect(result.entries).toEqual([
      { key: "PRIVATE_KEY", value: "first\nSECOND=inside\nlast" },
      { key: "PORT", value: "3000" },
    ]);
    expect(result.problems).toEqual([]);
  });

  test("reports an unclosed quoted value before processing its remaining lines", () => {
    const result = parseDotenv('PRIVATE_KEY="first\nSECOND=inside');

    expect(result.entries).toEqual([]);
    expect(result.problems.map((problem) => problem.line)).toEqual([1]);
  });

  test("keeps hashes within backticks and strips a trailing comment", () => {
    const result = parseDotenv("VALUE=`literal # value` # comment");

    expect(result.entries).toEqual([{ key: "VALUE", value: "literal # value" }]);
    expect(result.problems).toEqual([]);
  });
});

describe.each([
  ["LF", "\n"],
  ["CRLF", "\r\n"],
] as const)("shared multiline dotenv with %s endings", (_name, lineEnding) => {
  const parse = (text: string) =>
    parseDotenv(text.replaceAll(/\r\n?/g, "\n").replaceAll("\n", lineEnding));
  test("keeps comments and assignment-like text inside a multiline value", () => {
    const text = 'PRIVATE_KEY="first\n# literal\nOTHER=literal\nlast" # comment\nPORT=3000';
    expect(parse(text)).toEqual({
      entries: [
        { key: "PRIVATE_KEY", value: "first\n# literal\nOTHER=literal\nlast" },
        { key: "PORT", value: "3000" },
      ],
      problems: [],
    });
  });

  test("reports the original line number after a quoted multiline assignment", () => {
    const parsed = parse("VALUE='first\r\nsecond'\r\nBROKEN\r\nNELCOTA_KEY=reserved");
    expect(parsed.entries).toEqual([{ key: "VALUE", value: "first\nsecond" }]);
    expect(parsed.problems.map((problem) => problem.line)).toEqual([3, 4]);
  });

  test("does not import an unterminated quoted value or its apparent assignments", () => {
    const parsed = parse('PORT=3000\nPRIVATE_KEY="first\nOTHER=literal');
    expect(parsed.entries).toEqual([{ key: "PORT", value: "3000" }]);
    expect(parsed.problems).toEqual([
      { line: 2, text: 'PRIVATE_KEY="first', reason: "Valor entre aspas não foi fechado" },
    ]);
  });

  test("keeps interpolation literal and decodes existing double-quote escapes", () => {
    const parsed = parse('VALUE="first\\nsecond \\"quoted\\" ${PORT} $(id)"');
    expect(parsed.entries).toEqual([
      { key: "VALUE", value: 'first\nsecond "quoted" ${PORT} $(id)' },
    ]);
    expect(parsed.problems).toEqual([]);
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
