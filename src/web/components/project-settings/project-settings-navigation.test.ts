import { expect, test } from "bun:test";

import {
  legacySettingsDestination,
  visibleSettingsSections,
} from "./navigation/settings-destinations";

test("keeps read-only settings visible without offering restricted destinations", () => {
  expect(visibleSettingsSections(() => false).map((section) => section.id)).toEqual([
    "identity",
    "repository",
    "build",
    "runtime",
    "automation",
    "staging",
    "volumes",
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

test("groups related settings in task order with a description for each destination", () => {
  const destinations = visibleSettingsSections(() => true);

  const grouped = Map.groupBy(destinations, (destination) => destination.group);

  expect(
    Array.from(grouped, ([group, sections]) => [group, sections.map((section) => section.id)]),
  ).toEqual([
    ["Projeto", ["identity", "repository", "team"]],
    ["Deploy e execução", ["build", "runtime", "automation", "staging"]],
    ["Infraestrutura", ["volumes", "server"]],
    ["Zona de risco", ["deletion"]],
  ]);
  expect(destinations.every((destination) => destination.description.trim() !== "")).toBe(true);
});
