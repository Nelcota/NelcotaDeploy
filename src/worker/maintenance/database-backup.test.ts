import { describe, expect, test } from "bun:test";

import { isBackupDue } from "./database-backup";

const NOW = new Date("2026-10-29T12:00:00Z");

describe("isBackupDue", () => {
  test("is due when there is no backup yet", () => {
    expect(isBackupDue(null, NOW)).toBe(true);
  });

  test("is not due for a backup from a few hours ago", () => {
    expect(isBackupDue("2026-10-29T03:30:00Z", NOW)).toBe(false);
  });

  test("is due once the newest backup is a day old", () => {
    expect(isBackupDue("2026-10-28T12:00:00Z", NOW)).toBe(true);
  });

  test("is due when the stored time cannot be read", () => {
    expect(isBackupDue("not a date", NOW)).toBe(true);
  });
});
