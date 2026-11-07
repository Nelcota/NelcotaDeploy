import { expect, test } from "bun:test";

import { parseDockerfileHints } from "./dockerfile-hints";

test("reads literal shell and JSON volume paths and normalizes trailing separators", () => {
  expect(
    parseDockerfileHints(
      'FROM oven/bun:1.4\nVOLUME ["/app/data/", "/app/uploads"]\nVOLUME /cache "/logs"',
    ),
  ).toEqual({
    bun: true,
    volumes: ["/app/data", "/app/uploads", "/cache", "/logs"],
    limited: false,
  });
});

test("ignores discarded build stages and inherits only an explicitly reused stage", () => {
  expect(
    parseDockerfileHints("FROM oven/bun AS build\nVOLUME /builder\nFROM alpine\nVOLUME /data"),
  ).toEqual({ bun: false, volumes: ["/data"], limited: false });
  expect(
    parseDockerfileHints(
      "FROM oven/bun AS base\nVOLUME /data\nFROM scratch AS unused\nVOLUME /ignored\nFROM BASE\nVOLUME /cache",
    ).volumes,
  ).toEqual(["/data", "/cache"]);
});

test("supports comments, platform selection, case-insensitive directives and continuations", () => {
  expect(
    parseDockerfileHints(
      "# comment\nfrom --platform=linux/amd64 docker.io/oven/bun:1.4\nvolume /data \\\n# continued comment\n /logs\nVOLUME /data",
    ),
  ).toEqual({ bun: true, volumes: ["/data", "/logs"], limited: false });
});

test.each([
  "FROM oven/bun\nRUN <<EOF\nVOLUME /fake\nEOF",
  "# escape=`\nFROM oven/bun\nVOLUME /data",
  "FROM oven/bun\nVOLUME /builder\nFROM invalid extra syntax",
  "FROM oven/bun\nVOLUME /data \\",
])("leaves unsupported syntax for manual review: %s", (text) => {
  expect(parseDockerfileHints(text)).toEqual({ bun: false, volumes: [], limited: true });
});

test("excludes system directories, traversal, dynamic and relative paths", () => {
  expect(
    parseDockerfileHints(
      'FROM alpine\nVOLUME ["/data", "/etc", "/app/../data", "$DATA", "relative", "/"]',
    ),
  ).toEqual({ bun: false, volumes: ["/data"], limited: true });
});

test.each([
  "VOLUME /data",
  "FROM alpine\n# VOLUME /ignored",
  "FROM alpine\nRUN echo VOLUME /ignored",
  "FROM alpine\nONBUILD VOLUME /ignored",
])("does not invent mounts from %s", (text) => {
  expect(parseDockerfileHints(text).volumes).toEqual([]);
});

test.each([
  '["/data",]',
  "[1]",
  '"unterminated',
  "[" + Array.from({ length: 101 }, () => '"/data"').join(",") + "]",
])("flags malformed or excessive declarations", (value) => {
  expect(parseDockerfileHints(`FROM alpine\nVOLUME ${value}`)).toEqual({
    bun: false,
    volumes: [],
    limited: true,
  });
});
