import { describe, expect, test } from "bun:test";

import { scheduleNote } from "./schedule-note";

describe("scheduleNote", () => {
  test("shows the next run of an enabled task", () => {
    expect(scheduleNote({ enabled: true, nextRunAt: "2026-10-29T06:00:00Z" })).toEqual({
      kind: "next",
      at: "2026-10-29T06:00:00Z",
    });
  });

  test("says a disabled task does not run", () => {
    expect(scheduleNote({ enabled: false, nextRunAt: "2026-10-29T06:00:00Z" })).toEqual({
      kind: "paused",
    });
  });

  test("adds nothing for an enabled task without a next run", () => {
    expect(scheduleNote({ enabled: true, nextRunAt: null })).toBeNull();
  });
});
