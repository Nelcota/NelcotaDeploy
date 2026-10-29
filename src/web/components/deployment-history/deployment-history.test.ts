import { describe, expect, test } from "bun:test";

import {
  deploymentLabel,
  groupByDay,
  historyRefreshInterval,
  nextPageCursor,
  PAGE_SIZE,
  rollbackColumnState,
} from "./deployment-history";

describe("nextPageCursor", () => {
  test("returns undefined when the page is not full", () => {
    const page = [{ createdAt: "2026-10-28T10:00:00Z" }];

    const cursor = nextPageCursor(page);

    expect(cursor).toBeUndefined();
  });

  test("returns the oldest creation time of a full page", () => {
    const page = Array.from({ length: PAGE_SIZE }, (_, index) => ({
      createdAt: `2026-10-28T10:00:${String(PAGE_SIZE - index).padStart(2, "0")}Z`,
    }));

    const cursor = nextPageCursor(page);

    expect(cursor).toBe("2026-10-28T10:00:01Z");
  });
});

describe("historyRefreshInterval", () => {
  test("polls while a deploy is still running", () => {
    const interval = historyRefreshInterval([{ status: "succeeded" }, { status: "building" }]);

    expect(interval).toBeNumber();
  });

  test("stops polling when every deploy has finished", () => {
    const interval = historyRefreshInterval([{ status: "succeeded" }, { status: "failed" }]);

    expect(interval).toBe(false);
  });
});

describe("deploymentLabel", () => {
  test("shortens the built commit", () => {
    const label = deploymentLabel({ id: "d1", commitSha: "abcdef123", requestedCommitSha: null });

    expect(label).toBe("abcdef1");
  });

  test("falls back to the requested commit", () => {
    const label = deploymentLabel({ id: "d1", commitSha: null, requestedCommitSha: "123456789" });

    expect(label).toBe("1234567");
  });

  test("names the deploy by the end of its id when no commit is known", () => {
    const label = deploymentLabel({
      id: "x-0001234567",
      commitSha: null,
      requestedCommitSha: null,
    });

    expect(label).toBe("deploy 1234567");
  });
});

describe("groupByDay", () => {
  test("keeps deploys of the same day together in their original order", () => {
    const rows = [
      { id: "a", createdAt: "2026-10-28T15:00:00Z" },
      { id: "b", createdAt: "2026-10-28T14:00:00Z" },
      { id: "c", createdAt: "2026-10-26T14:00:00Z" },
    ];

    const groups = groupByDay(rows);

    expect(groups.map(([, items]) => items.map((item) => item.id))).toEqual([["a", "b"], ["c"]]);
  });
});

describe("rollbackColumnState", () => {
  test("hides the column when no listed deploy can be restored", () => {
    const state = rollbackColumnState(false, true);

    expect(state).toBe("hidden");
  });

  test("offers the button on a restorable deploy", () => {
    const state = rollbackColumnState(true, true);

    expect(state).toBe("available");
  });

  test("keeps an empty cell for alignment on other deploys", () => {
    const state = rollbackColumnState(true, false);

    expect(state).toBe("empty");
  });
});
