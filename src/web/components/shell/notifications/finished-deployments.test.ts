import { describe, expect, test } from "bun:test";

import { findFinishedDeployments } from "@/web/components/shell/notifications/finished-deployments";

describe("findFinishedDeployments", () => {
  test("reports a deployment that went from building to succeeded", () => {
    const previous = new Map([["d1", "building"]]);

    const finished = findFinishedDeployments(previous, [{ id: "d1", status: "succeeded" }], null);

    expect(finished.map((deployment) => deployment.id)).toEqual(["d1"]);
  });

  test("ignores a deployment that is still running", () => {
    const previous = new Map([["d1", "queued"]]);

    const finished = findFinishedDeployments(previous, [{ id: "d1", status: "building" }], null);

    expect(finished).toEqual([]);
  });

  test("ignores a deployment not seen at the previous poll", () => {
    const finished = findFinishedDeployments(new Map(), [{ id: "d1", status: "failed" }], null);

    expect(finished).toEqual([]);
  });

  test("ignores the deployment open on screen", () => {
    const previous = new Map([["d1", "building"]]);

    const finished = findFinishedDeployments(previous, [{ id: "d1", status: "failed" }], "d1");

    expect(finished).toEqual([]);
  });

  test("ignores a cancelled deployment", () => {
    const previous = new Map([["d1", "building"]]);

    const finished = findFinishedDeployments(previous, [{ id: "d1", status: "cancelled" }], null);

    expect(finished).toEqual([]);
  });
});
