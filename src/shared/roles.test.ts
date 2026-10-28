import { describe, expect, test } from "bun:test";

import { hasPermission, isRole } from "./roles";

describe("hasPermission", () => {
  test("admin can manage users", () => {
    expect(hasPermission("admin", "user:manage")).toBe(true);
  });

  test("developer can deploy and run tasks", () => {
    expect(hasPermission("developer", "deployment:create")).toBe(true);
    expect(hasPermission("developer", "task:run")).toBe(true);
  });

  test("developer cannot approve projects or manage users", () => {
    expect(hasPermission("developer", "project:approve")).toBe(false);
    expect(hasPermission("developer", "user:manage")).toBe(false);
  });

  test("viewer can only read", () => {
    expect(hasPermission("viewer", "project:read")).toBe(true);
    expect(hasPermission("viewer", "deployment:create")).toBe(false);
    expect(hasPermission("viewer", "container:control")).toBe(false);
    expect(hasPermission("viewer", "task:run")).toBe(false);
  });
});

describe("isRole", () => {
  test("rejects unknown values", () => {
    expect(isRole("root")).toBe(false);
    expect(isRole(null)).toBe(false);
  });
});
