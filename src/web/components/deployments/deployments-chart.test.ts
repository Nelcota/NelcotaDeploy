import { describe, expect, test } from "bun:test";

import { totalDeploymentDays } from "@/web/components/deployments/deployments-chart";

describe("totalDeploymentDays", () => {
  test("adds up every outcome across the days", () => {
    const totals = totalDeploymentDays([
      { day: "2026-10-27", succeeded: 3, failed: 1, other: 0 },
      { day: "2026-10-28", succeeded: 2, failed: 0, other: 1 },
    ]);

    expect(totals).toEqual({ succeeded: 5, failed: 1, other: 1 });
  });

  test("returns zeros for no days", () => {
    const totals = totalDeploymentDays([]);

    expect(totals).toEqual({ succeeded: 0, failed: 0, other: 0 });
  });
});
