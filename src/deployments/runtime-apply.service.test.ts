import { describe, expect, test } from "bun:test";

import { type Database, openMemoryDatabase } from "@/db";
import { addDomain } from "@/domains";
import { saveEnvironmentVariable } from "@/environments";
import { updateProject } from "@/projects";
import { createTestProject, createTestSecretBox, TEST_ACTOR } from "@/testing";

import { requestDeployment } from "./deployment-request.service";
import { completeDeployment, getDeployment, transitionDeployment } from "./deployment.service";
import { applyPendingChanges, applyRuntimeChanges } from "./runtime-apply.service";
import { buildConfigFingerprint, runtimeConfigFingerprint } from "./runtime-config";

const LIVE_COMMIT = "a".repeat(40);

const manual = { trigger: "manual" as const, actor: TEST_ACTOR, triggeredByUserId: null };
const context = { actor: TEST_ACTOR, triggeredByUserId: null };

/** Runs a deploy to the end, recording the fingerprint as the worker does. */
function deployLive(database: Database, projectId: string): string {
  const { deploymentId } = requestDeployment(database, { projectId, ...manual });
  transitionDeployment(database, deploymentId, { to: "cloning" });
  transitionDeployment(database, deploymentId, { to: "building", commitSha: LIVE_COMMIT });
  transitionDeployment(database, deploymentId, {
    to: "starting",
    imageTag: "nelcota/api:abc",
    containerName: "nelcota-api-abc",
    runtimeConfigHash: runtimeConfigFingerprint(database, projectId),
    buildConfigHash: buildConfigFingerprint(database, projectId),
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

async function saveVariable(
  database: Database,
  projectId: string,
  variable: { readonly key: string; readonly availableAtBuild: boolean },
): Promise<void> {
  await saveEnvironmentVariable(database, await createTestSecretBox(), {
    projectId,
    input: { ...variable, kind: "plain", value: "x", excludeFromPreviews: false },
    actor: TEST_ACTOR,
  });
}

describe("applyPendingChanges", () => {
  test("builds the live commit again when a build variable changed", async () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    deployLive(database, project.id);
    await saveVariable(database, project.id, { key: "VITE_API", availableAtBuild: true });

    const deploymentId = applyPendingChanges(database, project.id, context);

    const rebuild = getDeployment(database, deploymentId ?? "");
    expect(rebuild.sourceDeploymentId).toBeNull();
    expect(rebuild.requestedCommitSha).toBe(LIVE_COMMIT);
  });

  test("reuses the live image when only runtime variables changed", async () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const liveId = deployLive(database, project.id);
    await saveVariable(database, project.id, { key: "API_URL", availableAtBuild: false });

    const deploymentId = applyPendingChanges(database, project.id, context);

    expect(getDeployment(database, deploymentId ?? "").sourceDeploymentId).toBe(liveId);
  });

  test("applies changes even when the project does not apply them on its own", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database, { autoApplyChanges: false });
    deployLive(database, project.id);
    addTestDomain(database, project.id);

    expect(applyPendingChanges(database, project.id, context)).not.toBeNull();
  });
});
