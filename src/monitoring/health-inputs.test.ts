import { describe, expect, test } from "bun:test";

import { type Database, openMemoryDatabase } from "@/db";
import { completeDeployment, requestDeployment, transitionDeployment } from "@/deployments";
import { LOCAL_SERVER_ID } from "@/servers";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { listLiveAppContainers } from "./health-inputs";
import { replaceContainerSnapshots } from "./monitoring.service";

function deployLive(database: Database, projectId: string): string {
  const { deploymentId } = requestDeployment(database, {
    projectId,
    trigger: "manual",
    actor: TEST_ACTOR,
    triggeredByUserId: null,
  });
  transitionDeployment(database, deploymentId, { to: "cloning" });
  transitionDeployment(database, deploymentId, { to: "building" });
  transitionDeployment(database, deploymentId, {
    to: "starting",
    imageTag: "nelcota/api:abc",
    containerName: "nelcota-api-abc",
  });
  transitionDeployment(database, deploymentId, { to: "health_checking" });
  completeDeployment(database, deploymentId);
  return deploymentId;
}

function snapshot(projectId: string, deploymentId: string, state: string) {
  return {
    containerId: "c1",
    projectId,
    deploymentId,
    name: "nelcota-api-abc",
    image: "nelcota/api:abc",
    state,
    health: null,
    restartCount: 2,
    startedAt: null,
    observedAt: "2026-11-02T12:00:00Z",
  };
}

describe("listLiveAppContainers", () => {
  test("leaves out projects that were never deployed", () => {
    const database = openMemoryDatabase();
    createTestProject(database);

    expect(listLiveAppContainers(database)).toEqual([]);
  });

  test("reports no container when the worker saw none for the live deployment", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    deployLive(database, project.id);

    const [app] = listLiveAppContainers(database);

    expect(app?.projectId).toBe(project.id);
    expect(app?.container).toBeNull();
  });

  test("returns the state of the live container", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const deploymentId = deployLive(database, project.id);
    replaceContainerSnapshots(database, LOCAL_SERVER_ID, [
      snapshot(project.id, deploymentId, "exited"),
    ]);

    const [app] = listLiveAppContainers(database);

    expect(app?.container).toEqual({ state: "exited", restartCount: 2 });
    expect(app?.serverId).toBe(LOCAL_SERVER_ID);
  });
});
