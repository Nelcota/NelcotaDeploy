import { describe, expect, test } from "bun:test";

import { classifyDns } from "./dns-check";

const SERVER = "93.184.216.34";

describe("classifyDns", () => {
  test("is ok when the hostname resolves to the project's server", () => {
    expect(classifyDns(["2606:2800::1", SERVER], SERVER)).toBe("ok");
  });

  test("reports another address, such as an older server or a CDN", () => {
    expect(classifyDns(["104.16.0.1"], SERVER)).toBe("elsewhere");
  });

  test("reports a hostname that does not resolve yet", () => {
    expect(classifyDns([], SERVER)).toBe("missing");
  });

  test("cannot compare when the server's address is unknown", () => {
    expect(classifyDns(["104.16.0.1"], null)).toBe("unknown");
  });
});
