import { describe, expect, test } from "bun:test";

import {
  deploymentTitleId,
  durationEnd,
  finalStatusOf,
  headerActionOf,
  isActiveDeployment,
} from "./deployment-detail";

const NOW = new Date("2026-10-28T12:00:00Z");

describe("isActiveDeployment", () => {
  test("treats a building deploy as active", () => {
    expect(isActiveDeployment("building")).toBe(true);
  });

  test("treats a finished deploy as inactive", () => {
    expect(isActiveDeployment("succeeded")).toBe(false);
  });

  test("treats a deploy still loading as inactive", () => {
    expect(isActiveDeployment(undefined)).toBe(false);
  });
});

describe("deploymentTitleId", () => {
  test("uses seven characters of the commit", () => {
    const id = deploymentTitleId({ id: "d1", commitSha: "abcdef123", requestedCommitSha: null });

    expect(id).toBe("abcdef1");
  });

  test("uses the last eight characters of the id without a commit", () => {
    const id = deploymentTitleId({ id: "x-12345678", commitSha: null, requestedCommitSha: null });

    expect(id).toBe("12345678");
  });
});

describe("durationEnd", () => {
  test("uses the real end when the deploy finished", () => {
    const end = durationEnd(
      { startedAt: "2026-10-28T11:00:00Z", finishedAt: "2026-10-28T11:05:00Z" },
      false,
      NOW,
    );

    expect(end).toBe("2026-10-28T11:05:00Z");
  });

  test("uses now while a started deploy runs", () => {
    const end = durationEnd({ startedAt: "2026-10-28T11:00:00Z", finishedAt: null }, true, NOW);

    expect(end).toBe(NOW.toISOString());
  });

  test("returns null for a deploy that has not started", () => {
    const end = durationEnd({ startedAt: null, finishedAt: null }, true, NOW);

    expect(end).toBeNull();
  });
});

describe("headerActionOf", () => {
  const succeeded = { status: "succeeded", imageTag: "image:1", isLive: false } as const;

  test("offers nothing to users who cannot deploy", () => {
    expect(headerActionOf(succeeded, false)).toBeNull();
  });

  test("offers cancel while the deploy runs", () => {
    expect(headerActionOf({ ...succeeded, status: "building" }, true)).toBe("cancel");
  });

  test("offers retry after a failure", () => {
    expect(headerActionOf({ ...succeeded, status: "failed" }, true)).toBe("retry");
  });

  test("offers rollback to an older successful deploy", () => {
    expect(headerActionOf(succeeded, true)).toBe("rollback");
  });

  test("offers nothing on the live deploy", () => {
    expect(headerActionOf({ ...succeeded, isLive: true }, true)).toBeNull();
  });
});

describe("finalStatusOf", () => {
  test("reads a succeeded status", () => {
    expect(finalStatusOf({ status: "succeeded" })).toBe("succeeded");
  });

  test("ignores payloads without a status", () => {
    expect(finalStatusOf("done")).toBeNull();
  });

  test("ignores statuses that are not final results", () => {
    expect(finalStatusOf({ status: "cancelled" })).toBeNull();
  });
});
