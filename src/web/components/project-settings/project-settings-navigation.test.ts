import { expect, test } from "bun:test";

import { legacySettingsDestination, visibleSettingsSections } from "./project-settings-navigation";

test("keeps read-only settings visible without offering restricted destinations", () => {
  expect(visibleSettingsSections(() => false).map((section) => section.id)).toEqual([
    "identity",
    "repository",
    "build",
    "runtime",
    "automation",
    "volumes",
    "staging",
  ]);
});

test.each(["", "#unknown", "#toString"])("opens the settings index for %j", (hash) => {
  expect(legacySettingsDestination(hash)).toBe("/projects/$projectId/settings");
});

test.each([
  ["#settings-general", "identity"],
  ["settings-build", "build"],
  ["#settings-repository", "repository"],
  ["#settings-access", "repository"],
  ["#settings-volumes", "volumes"],
  ["#settings-automation", "automation"],
  ["#settings-server", "server"],
  ["#settings-danger", "deletion"],
])("resolves legacy bookmark %s to %s", (hash, page) => {
  expect<string>(legacySettingsDestination(hash)).toBe(`/projects/$projectId/settings/${page}`);
});

test("includes each administrative destination only with its corresponding permission", () => {
  const links = visibleSettingsSections((permission) => permission === "project:approve");

  expect(links.some((section) => section.id === "repository")).toBe(true);
  expect(links.some((section) => section.id === "server")).toBe(false);
  expect(links.some((section) => section.id === "deletion")).toBe(false);
  expect(
    visibleSettingsSections((permission) => permission === "settings:write").some(
      (section) => section.id === "server",
    ),
  ).toBe(true);
  expect(
    visibleSettingsSections((permission) => permission === "project:delete").some(
      (section) => section.id === "deletion",
    ),
  ).toBe(true);
});

test("offers a unique route for each function to administrators", () => {
  const links = visibleSettingsSections(() => true);

  expect(links).toHaveLength(10);
  expect(new Set(links.map((section) => section.id)).size).toBe(links.length);
  expect(new Set(links.map((section) => section.to)).size).toBe(links.length);
});
