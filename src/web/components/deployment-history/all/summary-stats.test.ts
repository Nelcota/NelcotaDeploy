import { describe, expect, test } from "bun:test";

import { summaryStats } from "./summary-stats";

const STATS = {
  total: 10,
  succeeded: 8,
  failed: 2,
  successRatePercent: 80,
  averageDurationInMs: 60_000,
};

describe("summaryStats", () => {
  test("flags failures as danger", () => {
    const stats = summaryStats(STATS);

    expect(stats[2]).toMatchObject({ value: 2, tone: "danger" });
  });

  test("keeps the failure tile neutral when nothing failed", () => {
    const stats = summaryStats({ ...STATS, failed: 0 });

    expect(stats[2]?.tone).toBe("default");
  });

  test("shows a dash for the success rate when there were no finished deploys", () => {
    const stats = summaryStats({ ...STATS, successRatePercent: null });

    expect(stats[1]?.value).toBe("—");
  });
});
