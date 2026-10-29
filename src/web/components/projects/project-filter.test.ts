import { describe, expect, test } from "bun:test";

import { matchesProjectFilter } from "./project-filter";

const RUNNING = {
  containerState: "running",
  containerHealth: "healthy",
  deploymentsApproved: true,
};
const FAILING = {
  containerState: "running",
  containerHealth: "unhealthy",
  deploymentsApproved: true,
};
const STOPPED = { containerState: "exited", containerHealth: null, deploymentsApproved: true };
const NEVER = { containerState: null, containerHealth: null, deploymentsApproved: false };

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
    expect(matchesProjectFilter(RUNNING, "offline")).toBe(false);
  });

  test("lists projects without a container as never deployed", () => {
    expect(matchesProjectFilter(NEVER, "never")).toBe(true);
    expect(matchesProjectFilter(RUNNING, "never")).toBe(false);
  });

  test("lists projects waiting for approval", () => {
    expect(matchesProjectFilter(NEVER, "pending")).toBe(true);
    expect(matchesProjectFilter(RUNNING, "pending")).toBe(false);
  });
});
