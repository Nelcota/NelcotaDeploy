import { describe, expect, test } from "bun:test";

import { ALL_DEPLOYMENTS, runtimeLogsUrl, shortShaOf } from "./runtime-logs";

describe("runtimeLogsUrl", () => {
  test("streams every recent deploy when all are selected", () => {
    const url = runtimeLogsUrl("project-1", ALL_DEPLOYMENTS);

    expect(url).toBe("/api/projects/project-1/runtime-logs");
  });

  test("filters by an encoded deployment id when one is selected", () => {
    const url = runtimeLogsUrl("project-1", "a b&c");

    expect(url).toBe("/api/projects/project-1/runtime-logs?deploymentId=a%20b%26c");
  });
});

describe("shortShaOf", () => {
  test("uses the first seven characters of the built commit", () => {
    const label = shortShaOf({ id: "deploy-1", commitSha: "abcdef1234", requestedCommitSha: null });

    expect(label).toBe("abcdef1");
  });

  test("falls back to the requested commit while the build has not resolved one", () => {
    const label = shortShaOf({ id: "deploy-1", commitSha: null, requestedCommitSha: "1234567890" });

    expect(label).toBe("1234567");
  });

  test("uses the end of the deployment id when no commit is known", () => {
    const label = shortShaOf({
      id: "deploy-0001234567",
      commitSha: null,
      requestedCommitSha: null,
    });

    expect(label).toBe("1234567");
  });
});
