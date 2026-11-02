import { describe, expect, test } from "bun:test";

import { needsTwoFactorSetup } from "./session";

const required = { requireAdminTwoFactor: true };

describe("needsTwoFactorSetup", () => {
  test("requires it from an admin without two-factor authentication", () => {
    expect(needsTwoFactorSetup({ role: "admin", twoFactorEnabled: false }, required)).toBe(true);
  });

  test("lets an admin who already has it through", () => {
    expect(needsTwoFactorSetup({ role: "admin", twoFactorEnabled: true }, required)).toBe(false);
  });

  test("does not require it from developers", () => {
    expect(needsTwoFactorSetup({ role: "developer", twoFactorEnabled: false }, required)).toBe(
      false,
    );
  });

  test("does not require it while the organization does not", () => {
    const user = { role: "admin", twoFactorEnabled: false } as const;

    expect(needsTwoFactorSetup(user, { requireAdminTwoFactor: false })).toBe(false);
  });
});
