import { describe, expect, test } from "bun:test";

import { type Database, openMemoryDatabase } from "@/db";
import { addDomain } from "@/domains";
import { updateProject } from "@/projects";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { requestDeployment } from "./deployment-request.service";
import { completeDeployment, getDeployment, transitionDeployment } from "./deployment.service";
import { applyRuntimeChanges } from "./runtime-apply.service";
import { runtimeConfigFingerprint } from "./runtime-config";

const manual = { trigger: "manual" as const, actor: TEST_ACTOR, triggeredByUserId: null };
const context = { actor: TEST_ACTOR, triggeredByUserId: null };

/** Runs a deploy to the end, recording the fingerprint as the worker does. */
function deployLive(database: Database, projectId: string): string {
  const { deploymentId } = requestDeployment(database, { projectId, ...manual });
  transitionDeployment(database, deploymentId, { to: "cloning" });
  transitionDeployment(database, deploymentId, { to: "building" });
  transitionDeployment(database, deploymentId, {
    to: "starting",
    imageTag: "nelcota/api:abc",
    containerName: "nelcota-api-abc",
    runtimeConfigHash: runtimeConfigFingerprint(database, projectId),
  });
  transitionDeployment(database, deploymentId, { to: "health_checking" });
  completeDeployment(database, deploymentId);
  return deploymentId;
}

function addTestDomain(database: Database, projectId: string): void {
  addDomain(database, {
    projectId,
    input: { hostname: "app.example.com", httpsEnabled: true },
    actor: TEST_ACTOR,
  });
}

describe("applyRuntimeChanges", () => {
  test("queues a redeploy of the live image when the domains changed", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const liveId = deployLive(database, project.id);
    addTestDomain(database, project.id);

    const deploymentId = applyRuntimeChanges(database, project.id, context);

    expect(deploymentId).not.toBeNull();
    const redeploy = getDeployment(database, deploymentId ?? "");
    expect(redeploy.trigger).toBe("redeploy");
    expect(redeploy.sourceDeploymentId).toBe(liveId);
  });
});

describe("applyRuntimeChanges skips", () => {
  test("a project where nothing changed", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    deployLive(database, project.id);

    expect(applyRuntimeChanges(database, project.id, context)).toBeNull();
  });

  test("a project that was never deployed", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    addTestDomain(database, project.id);

    expect(applyRuntimeChanges(database, project.id, context)).toBeNull();
  });

  test("a project that applies changes by hand", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database, { autoApplyChanges: false });
    deployLive(database, project.id);
    addTestDomain(database, project.id);

    expect(applyRuntimeChanges(database, project.id, context)).toBeNull();
  });

  test("a project with a queued deployment, which starts with the new configuration", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    deployLive(database, project.id);
    const queued = requestDeployment(database, { projectId: project.id, ...manual });
    addTestDomain(database, project.id);

    const result = applyRuntimeChanges(database, project.id, context);

    expect(result).toBeNull();
    expect(getDeployment(database, queued.deploymentId).status).toBe("queued");
  });
});

describe("applyRuntimeChanges after a repository change", () => {
  test("skips a project that needs approval again", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    deployLive(database, project.id);
    updateProject(database, {
      projectId: project.id,
      input: { ...project, repositoryUrl: "https://github.com/acme/other", internalPort: 3000 },
      editor: { actor: TEST_ACTOR, isAdmin: false },
    });
    addTestDomain(database, project.id);

    expect(applyRuntimeChanges(database, project.id, context)).toBeNull();
  });
});
