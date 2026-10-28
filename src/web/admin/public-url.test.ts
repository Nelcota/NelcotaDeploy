import { describe, expect, test } from "bun:test";

import { isUnreachableFromInternet } from "./public-url";

describe("isUnreachableFromInternet", () => {
  test.each([
    "http://localhost:3000/api/webhooks/github",
    "http://127.0.0.1/api/webhooks/github",
    "http://[::1]:3000/api/webhooks/github",
    "http://painel.local/api/webhooks/github",
    "http://deploy.internal/api/webhooks/github",
  ])("flags %p as local", (url) => {
    expect(isUnreachableFromInternet(url)).toBe(true);
  });

  test("accepts a public domain", () => {
    expect(isUnreachableFromInternet("https://deploy.exemplo.com/api/webhooks/github")).toBe(false);
  });

  test("flags text that is not a URL", () => {
    expect(isUnreachableFromInternet("not a url")).toBe(true);
  });
});
