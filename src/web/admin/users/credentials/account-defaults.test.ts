import { expect, test } from "bun:test";

import { passwordSchema } from "@/shared/schemas/user.schema";

import { generateAccountPassword, parseAccountAddress } from "./account-defaults";

test("generates distinct, strong passwords accepted by the account schema", () => {
  const passwords = Array.from({ length: 100 }, generateAccountPassword);
  expect(new Set(passwords).size).toBe(100);
  expect(
    passwords.every(
      (password) =>
        password.length === 24 &&
        /^[A-Za-z0-9_-]+$/.test(password) &&
        passwordSchema.safeParse(password).success,
    ),
  ).toBe(true);
});

test.each([
  ['"Ana Silva" <ANA@example.com>', { name: "Ana Silva", email: "ana@example.com" }],
  ["  José da Silva <jose@example.com>  ", { name: "José da Silva", email: "jose@example.com" }],
  ["  FIRST.LAST@example.com  ", { name: null, email: "first.last@example.com" }],
] as const)("uses explicit account details from %s", (address, expected) => {
  expect(parseAccountAddress(address)).toEqual(expected);
});

test.each([
  "",
  " ",
  "not-an-email",
  "Name <invalid>",
  "Name <first@example.com>, Other <second@example.com>",
  "Name\nInjected <first@example.com>",
  "<first@example.com>",
  `${"a".repeat(81)} <first@example.com>`,
  "mailto:first@example.com?subject=example",
])("refuses ambiguous or invalid account input %s", (address) => {
  expect(parseAccountAddress(address)).toBeNull();
});
