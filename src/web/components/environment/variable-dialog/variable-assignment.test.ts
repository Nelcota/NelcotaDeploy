import { expect, test } from "bun:test";

import { parseVariableAssignment } from "./variable-assignment";

test.each([
  ["NODE_ENV=production", { key: "NODE_ENV", value: "production" }],
  [' export app_name="Minha aplicação" ', { key: "APP_NAME", value: "Minha aplicação" }],
  ["TOKEN=abc=def==", { key: "TOKEN", value: "abc=def==" }],
  ["OPTION=", { key: "OPTION", value: "" }],
  ["MODE=production # comment", { key: "MODE", value: "production" }],
  ['KEY="first\\nsecond"', { key: "KEY", value: "first\nsecond" }],
  ["VALUE=$(some-command)", { key: "VALUE", value: "$(some-command)" }],
] as const)("parses a single pasted assignment %s", (text, expected) => {
  expect(parseVariableAssignment(text)).toEqual(expected);
});

test.each([
  "",
  " ",
  "NAME",
  "=value",
  "PATH=/tmp",
  "bad-key=value",
  "A=1\nB=2",
  "A=1\nA=2",
  "A=bad\0value",
  `A=${"x".repeat(32_769)}`,
  `A=${"x".repeat(33_001)}`,
])("leaves unsupported or unsafe pasted text untouched", (text) => {
  expect(parseVariableAssignment(text)).toBeNull();
});
