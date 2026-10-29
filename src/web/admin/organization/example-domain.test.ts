import { describe, expect, test } from "bun:test";

import { exampleDomainOf } from "./example-domain";

describe("exampleDomainOf", () => {
  test("uses the typed domain without surrounding spaces", () => {
    expect(exampleDomainOf("  apps.nelcota.com ")).toBe("apps.nelcota.com");
  });

  test("falls back to a sample when blank", () => {
    expect(exampleDomainOf("   ")).toBe("apps.exemplo.com");
  });
});
