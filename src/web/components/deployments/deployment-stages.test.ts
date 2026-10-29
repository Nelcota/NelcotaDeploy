import { describe, expect, test } from "bun:test";

import { stageStates } from "@/web/components/deployments/deployment-stages";

const base = { sourceDeploymentId: null, commitSha: null, imageTag: null, containerName: null };

describe("stageStates", () => {
  test("marks earlier stages done and the running one current", () => {
    const states = stageStates({ ...base, status: "building", commitSha: "abc" });

    expect(states).toEqual(["done", "done", "current", "pending", "pending", "pending"]);
  });

  test("marks every stage done when the deployment succeeded", () => {
    const states = stageStates({
      ...base,
      status: "succeeded",
      commitSha: "abc",
      imageTag: "nelcota/api:1",
      containerName: "nelcota-api-1",
    });

    expect(states).toEqual(["done", "done", "done", "done", "done", "done"]);
  });

  test("skips clone and build for a rollback", () => {
    const states = stageStates({
      ...base,
      status: "starting",
      sourceDeploymentId: "d1",
      imageTag: "x:1",
    });

    expect(states).toEqual(["done", "skipped", "skipped", "current", "pending", "pending"]);
  });
});

describe("stageStates failures", () => {
  test("places a failure without commit at the clone stage", () => {
    expect(stageStates({ ...base, status: "failed" })[1]).toBe("failed");
  });

  test("places a failure without image at the build stage", () => {
    expect(stageStates({ ...base, status: "failed", commitSha: "abc" })[2]).toBe("failed");
  });

  test("places a failure with a container at the health check", () => {
    const states = stageStates({
      ...base,
      status: "failed",
      commitSha: "abc",
      imageTag: "x:1",
      containerName: "c",
    });

    expect(states[4]).toBe("failed");
    expect(states[5]).toBe("pending");
  });

  test("shows a cancelled deployment as cancelled at the stage it stopped", () => {
    expect(stageStates({ ...base, status: "cancelled", commitSha: "abc" })[2]).toBe("cancelled");
  });
});
