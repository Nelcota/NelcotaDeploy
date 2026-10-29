import { describe, expect, test } from "bun:test";

import { firstPublicAddress } from "./server-checker";

describe("firstPublicAddress", () => {
  test("skips private and Docker bridge addresses", () => {
    const output = "10.0.0.5 172.17.0.1 2001:db8::1 93.184.216.34 \n";

    expect(firstPublicAddress(output)).toBe("93.184.216.34");
  });

  test("finds a public IPv6 address when there is no public IPv4", () => {
    expect(firstPublicAddress("192.168.1.2 2606:4700::6810:84e5")).toBe("2606:4700::6810:84e5");
  });

  test.each([[""], ["10.0.0.5 172.17.0.1"], ["   "]])("returns null for %p", (output) => {
    expect(firstPublicAddress(output)).toBeNull();
  });
});
