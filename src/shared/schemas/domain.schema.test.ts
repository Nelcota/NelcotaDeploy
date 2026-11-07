import { expect, test } from "bun:test";

import { domainInputSchema, isValidHostname } from "./domain.schema";

test.each([
  "example.com",
  "api.example.com",
  "xn--bcher-kva.example",
  "a.b",
  `${"a".repeat(63)}.example`,
])("accepts a lowercase fully qualified hostname %s", (hostname) => {
  expect(isValidHostname(hostname)).toBe(true);
});

test.each([
  "",
  "localhost",
  "example.com.",
  "Example.com",
  ".example.com",
  "a..example.com",
  "bad_.example.com",
  "-bad.example.com",
  "bad-.example.com",
  "example.com:443",
  "https://example.com",
  `${"a".repeat(64)}.example`,
  `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}`,
  "a.com`) || Host(`b.com",
])("rejects an invalid or unsupported hostname %s", (hostname) => {
  expect(isValidHostname(hostname)).toBe(false);
});

test("normalizes user input without weakening the lowercase routing boundary", () => {
  expect(domainInputSchema.parse({ hostname: "  API.EXAMPLE.COM  ", httpsEnabled: true })).toEqual({
    hostname: "api.example.com",
    httpsEnabled: true,
  });
});
