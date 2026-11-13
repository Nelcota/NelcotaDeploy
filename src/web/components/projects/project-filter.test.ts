import { describe, expect, test } from "bun:test";

import { matchesProjectFilter } from "./project-filter";

const RUNNING = {
  runtimeStatus: "online" as const,
  deploymentsApproved: true,
};
const FAILING = {
  runtimeStatus: "unhealthy" as const,
  deploymentsApproved: true,
};
const STOPPED = { runtimeStatus: "offline", deploymentsApproved: true } as const;
const UNMONITORED = { runtimeStatus: "unmonitored", deploymentsApproved: true } as const;
const NEVER = { runtimeStatus: "never-deployed", deploymentsApproved: false } as const;

describe("matchesProjectFilter", () => {
  test("lists every project under all", () => {
    expect(matchesProjectFilter(NEVER, "all")).toBe(true);
  });

  test("lists only healthy running projects as online", () => {
    expect(matchesProjectFilter(RUNNING, "online")).toBe(true);
    expect(matchesProjectFilter(FAILING, "online")).toBe(false);
  });

  test("lists stopped and failing projects as needing attention", () => {
    expect(matchesProjectFilter(STOPPED, "offline")).toBe(true);
    expect(matchesProjectFilter(FAILING, "offline")).toBe(true);
    expect(matchesProjectFilter(UNMONITORED, "offline")).toBe(true);
    expect(matchesProjectFilter(RUNNING, "offline")).toBe(false);
  });

  test("lists projects without a published release as never deployed", () => {
    expect(matchesProjectFilter(NEVER, "never")).toBe(true);
    expect(matchesProjectFilter(RUNNING, "never")).toBe(false);
    expect(matchesProjectFilter(UNMONITORED, "never")).toBe(false);
  });

  test("lists projects waiting for approval", () => {
    expect(matchesProjectFilter(NEVER, "pending")).toBe(true);
    expect(matchesProjectFilter(RUNNING, "pending")).toBe(false);
  });

  test("finds a running project with a certificate failure and excludes projects without one", () => {
    expect(
      matchesProjectFilter({ ...RUNNING, httpsIssueDomains: ["app.example.com"] }, "https"),
    ).toBe(true);
    expect(matchesProjectFilter(FAILING, "https")).toBe(false);
  });
});
