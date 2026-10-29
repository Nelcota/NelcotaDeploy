import { describe, expect, test } from "bun:test";

import type { ContainerInfo } from "@/docker";

import { deletedProjectIds } from "./server-fleet";

function container(labels: Record<string, string>): ContainerInfo {
  return {
    id: crypto.randomUUID(),
    name: "nelcota-api",
    image: "nelcota/api:abc",
    status: "running",
    running: true,
    health: null,
    restartCount: 0,
    startedAt: null,
    labels,
    networkAddresses: {},
  };
}

describe("deletedProjectIds", () => {
  test("finds containers whose project was deleted", () => {
    const containers = [
      container({ "io.nelcota.project-id": "kept" }),
      container({ "io.nelcota.project-id": "deleted" }),
    ];

    const deleted = deletedProjectIds(containers, new Set(["kept"]));

    expect([...deleted]).toEqual(["deleted"]);
  });

  test("ignores containers without a project, such as the proxy", () => {
    const deleted = deletedProjectIds([container({ "io.nelcota.proxy": "true" })], new Set());

    expect(deleted.size).toBe(0);
  });
});
