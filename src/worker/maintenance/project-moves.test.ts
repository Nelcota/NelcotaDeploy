import { describe, expect, test } from "bun:test";

import { canFinishMove } from "./project-moves";

const NOW = new Date("2026-10-29T12:00:00Z");

describe("canFinishMove", () => {
  test("finishes as soon as every domain points at the new server", () => {
    expect(canFinishMove({ domainsMoved: true, liveSince: null, now: NOW })).toBe(true);
  });

  test("keeps the old container while DNS still points at the old server", () => {
    const liveSince = "2026-10-29T11:00:00Z";

    expect(canFinishMove({ domainsMoved: false, liveSince, now: NOW })).toBe(false);
  });

  test("finishes after a day even if DNS never changed", () => {
    const liveSince = "2026-10-28T12:00:00Z";

    expect(canFinishMove({ domainsMoved: false, liveSince, now: NOW })).toBe(true);
  });

  test.each([[null], ["not a date"]])("waits when the live time is %p", (liveSince) => {
    expect(canFinishMove({ domainsMoved: false, liveSince, now: NOW })).toBe(false);
  });
});
