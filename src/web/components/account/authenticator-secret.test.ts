import { describe, expect, test } from "bun:test";

import { authenticatorSecret } from "./authenticator-secret";

describe("authenticatorSecret", () => {
  test("groups the secret in fours", () => {
    const uri = "otpauth://totp/Nelcota%20Deploy:ana@x.com?secret=JBSWY3DPEHPK3PXP&issuer=Nelcota";

    expect(authenticatorSecret(uri)).toBe("JBSW Y3DP EHPK 3PXP");
  });

  test("returns null for a URI without a secret", () => {
    expect(authenticatorSecret("otpauth://totp/Nelcota:ana@x.com")).toBeNull();
  });

  test("returns null for text that is not a URI", () => {
    expect(authenticatorSecret("not a uri")).toBeNull();
  });
});
