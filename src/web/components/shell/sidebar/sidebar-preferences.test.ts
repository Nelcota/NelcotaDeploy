import { describe, expect, test } from "bun:test";

import {
  defaultSidebarPreferences,
  parseSidebarPreferences,
  PINNED_PROJECT_LIMIT,
  togglePinnedProject,
  visiblePinnedProjectIds,
} from "./sidebar-preferences";

describe("parseSidebarPreferences", () => {
  test("restores the compact layout and pin order", () => {
    const saved = JSON.stringify({ collapsed: true, pinnedProjectIds: ["api", "site"] });

    const preferences = parseSidebarPreferences(saved);

    expect(preferences).toEqual({ collapsed: true, pinnedProjectIds: ["api", "site"] });
  });

  test.each([
    null,
    "",
    "   ",
    "null",
    "[]",
    "{}",
    "{",
    '{"collapsed":"false","pinnedProjectIds":[]}',
    '{"collapsed":false,"pinnedProjectIds":[null]}',
    '{"collapsed":false,"pinnedProjectIds":["   "]}',
    JSON.stringify({ collapsed: false, pinnedProjectIds: ["a", "b", "c", "d", "e"] }),
    JSON.stringify({ collapsed: false, pinnedProjectIds: ["a".repeat(129)] }),
    " ".repeat(2049),
  ])("uses defaults for invalid saved preferences %j", (value) => {
    expect(parseSidebarPreferences(value)).toEqual(defaultSidebarPreferences());
  });

  test("removes duplicate saved pins", () => {
    const saved = JSON.stringify({ collapsed: false, pinnedProjectIds: ["api", "api", "site"] });

    const preferences = parseSidebarPreferences(saved);

    expect(preferences.pinnedProjectIds).toEqual(["api", "site"]);
  });
});

describe("visiblePinnedProjectIds", () => {
  test("omits deleted or inaccessible projects while preserving the pin order", () => {
    const pins = ["removed", "site", "api", "private"];

    const visible = visiblePinnedProjectIds(pins, ["api", "site"]);

    expect(visible).toEqual(["site", "api"]);
  });

  test("shows no pins when no projects are accessible", () => {
    expect(visiblePinnedProjectIds(["api"], [])).toEqual([]);
  });

  test("keeps the sidebar within its visible project limit", () => {
    const pins = ["a", "b", "c", "d", "e"];

    const visible = visiblePinnedProjectIds(pins, pins);

    expect(visible).toEqual(pins.slice(0, PINNED_PROJECT_LIMIT));
  });
});

describe("togglePinnedProject", () => {
  test("pins an accessible project without changing the input preferences", () => {
    const preferences = { collapsed: true, pinnedProjectIds: ["api"] };

    const updated = togglePinnedProject(preferences, "site", ["api", "site"]);

    expect(updated).toEqual({ collapsed: true, pinnedProjectIds: ["api", "site"] });
    expect(preferences.pinnedProjectIds).toEqual(["api"]);
  });

  test("unpins an already selected project", () => {
    const preferences = { collapsed: false, pinnedProjectIds: ["api", "site"] };

    const updated = togglePinnedProject(preferences, "api", ["api", "site"]);

    expect(updated.pinnedProjectIds).toEqual(["site"]);
  });

  test("refuses a fifth pinned project", () => {
    const preferences = { collapsed: false, pinnedProjectIds: ["a", "b", "c", "d"] };

    const updated = togglePinnedProject(preferences, "e", ["a", "b", "c", "d", "e"]);

    expect(updated.pinnedProjectIds).toEqual(preferences.pinnedProjectIds);
  });

  test("allows unpinning when the limit has been reached", () => {
    const preferences = { collapsed: false, pinnedProjectIds: ["a", "b", "c", "d"] };

    const updated = togglePinnedProject(preferences, "c", ["a", "b", "c", "d"]);

    expect(updated.pinnedProjectIds).toEqual(["a", "b", "d"]);
  });

  test("reclaims pin slots after a project is removed or access is revoked", () => {
    const preferences = { collapsed: false, pinnedProjectIds: ["a", "b", "c", "removed"] };

    const updated = togglePinnedProject(preferences, "new", ["a", "b", "c", "new"]);

    expect(updated.pinnedProjectIds).toEqual(["a", "b", "c", "new"]);
  });

  test.each(["missing", "", "   "])("does not pin an unavailable project %j", (projectId) => {
    const preferences = defaultSidebarPreferences();

    const updated = togglePinnedProject(preferences, projectId, ["api"]);

    expect(updated).toEqual(preferences);
  });
});
