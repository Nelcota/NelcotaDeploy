import { expect, test } from "bun:test";

import { domainAddressSchema, parseDomainAddress } from "./domain-address";

test("validates and normalizes a complete address when submitted without blurring", () => {
  expect(
    domainAddressSchema.parse({ hostname: "https://app.example.com/path", httpsEnabled: true }),
  ).toEqual({ hostname: "app.example.com", httpsEnabled: true });
  expect(
    domainAddressSchema.safeParse({
      hostname: "https://user:private@app.example.com",
      httpsEnabled: true,
    }).success,
  ).toBe(false);
});

test.each([
  ["  APP.Example.com  ", { hostname: "app.example.com", httpsEnabled: null }],
  [
    "https://APP.example.com/path?tab=one#anchor",
    { hostname: "app.example.com", httpsEnabled: true },
  ],
  ["http://app.example.com/", { hostname: "app.example.com", httpsEnabled: false }],
  ["https://app.example.com:443/", { hostname: "app.example.com", httpsEnabled: true }],
] as const)("extracts the hostname and scheme from %s", (value, expected) => {
  expect(parseDomainAddress(value)).toEqual(expected);
});

test.each([
  "",
  " ",
  "https://user:private@app.example.com",
  "https://app.example.com:8080",
  "ssh://app.example.com",
  "javascript:alert(1)",
  "https://localhost",
  "https://[::1]",
  "https://app.example.com\n/route",
  "x".repeat(4097),
])("rejects invalid or unsupported domain address %s", (value) => {
  expect(parseDomainAddress(value)).toBeNull();
});
