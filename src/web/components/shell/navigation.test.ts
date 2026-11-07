import { expect, test } from "bun:test";

import { legacyAdministrationDestination, SETTINGS_SECTIONS } from "./navigation";

test.each([
  [undefined, "/settings/organization"],
  ["", "/settings/organization"],
  ["unknown", "/settings/organization"],
  ["organization", "/settings/organization"],
  ["servers", "/settings/servers"],
  ["server", "/settings/system"],
  ["users", "/settings/organization"],
  ["tokens", "/settings/organization"],
  ["audit", "/settings/organization"],
])("resolves legacy tab %s safely without elevated permissions", (tab, path) => {
  expect<string>(legacyAdministrationDestination(tab, [])).toBe(path);
});

test("requires each restricted destination's own permission", () => {
  expect(legacyAdministrationDestination("users", ["user:manage"])).toBe("/settings/users");
  expect(legacyAdministrationDestination("tokens", ["token:manage"])).toBe("/settings/tokens");
  expect(legacyAdministrationDestination("audit", ["audit:read"])).toBe("/settings/audit");
  expect(legacyAdministrationDestination("users", ["audit:read"])).toBe("/settings/organization");
  expect(legacyAdministrationDestination("webhooks", ["audit:read"])).toBe("/settings/webhooks");
  expect(legacyAdministrationDestination("webhooks", [])).toBe("/settings/organization");
});

test("gives every administration function its own route", () => {
  expect(new Set(SETTINGS_SECTIONS.map((section) => section.to)).size).toBe(
    SETTINGS_SECTIONS.length,
  );
});
