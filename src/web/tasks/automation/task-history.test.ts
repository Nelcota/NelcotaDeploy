import { describe, expect, test } from "bun:test";

import { taskHistoryRefreshInterval } from "./task-history";

describe("taskHistoryRefreshInterval", () => {
  test("discovers a first execution while the history is empty", () => {
    expect(taskHistoryRefreshInterval([])).toBe(15_000);
  });

  test("discovers scheduled executions after earlier executions finish", () => {
    expect(taskHistoryRefreshInterval([{ status: "succeeded" }, { status: "failed" }])).toBe(
      15_000,
    );
  });

  test.each(["queued", "running"])(
    "follows an execution in status %s more frequently",
    (status) => {
      expect(taskHistoryRefreshInterval([{ status: "succeeded" }, { status }])).toBe(3000);
    },
  );
});
