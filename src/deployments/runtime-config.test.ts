import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { type Database, openMemoryDatabase, tables } from "@/db";
import { addDomain } from "@/domains";
import { saveEnvironmentVariable } from "@/environments";
import { createTestProject, createTestSecretBox, TEST_ACTOR } from "@/testing";

import { completeDeployment, requestDeployment, transitionDeployment } from "./deployment.service";
import { hasPendingRuntimeChanges, runtimeConfigFingerprint } from "./runtime-config";

const manual = { trigger: "manual" as const, actor: TEST_ACTOR, triggeredByUserId: null };

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

async function saveVariable(database: Database, projectId: string, value: string): Promise<void> {
  const box = await createTestSecretBox();
  await saveEnvironmentVariable(database, box, {
    projectId,
    input: { key: "API_URL", kind: "plain", value, availableAtBuild: false },
    actor: TEST_ACTOR,
  });
}

describe("runtimeConfigFingerprint", () => {
  test("stays the same while nothing changes", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);

    const first = runtimeConfigFingerprint(database, project.id);
    const second = runtimeConfigFingerprint(database, project.id);

    expect(second).toBe(first);
  });

  test("changes when a domain is added", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const before = runtimeConfigFingerprint(database, project.id);

    addDomain(database, {
      projectId: project.id,
      input: { hostname: "app.example.com", httpsEnabled: true },
      actor: TEST_ACTOR,
    });

    expect(runtimeConfigFingerprint(database, project.id)).not.toBe(before);
  });
});

describe("hasPendingRuntimeChanges", () => {
  test("is false for a project that was never deployed", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);

    expect(hasPendingRuntimeChanges(database, project.id)).toBe(false);
  });

  test("is false right after a deploy", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    deployLive(database, project.id);

    expect(hasPendingRuntimeChanges(database, project.id)).toBe(false);
  });

  test("is true after a variable is saved", async () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    deployLive(database, project.id);

    await saveVariable(database, project.id, "https://api.example.com");

    expect(hasPendingRuntimeChanges(database, project.id)).toBe(true);
  });

  test("is false again after a new deploy applies the change", async () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    deployLive(database, project.id);
    await saveVariable(database, project.id, "https://api.example.com");

    deployLive(database, project.id);

    expect(hasPendingRuntimeChanges(database, project.id)).toBe(false);
  });

  test("is false when the live deploy predates fingerprints", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const deploymentId = deployLive(database, project.id);
    database
      .update(tables.deployments)
      .set({ runtimeConfigHash: null })
      .where(eq(tables.deployments.id, deploymentId))
      .run();
    addDomain(database, {
      projectId: project.id,
      input: { hostname: "app.example.com", httpsEnabled: true },
      actor: TEST_ACTOR,
    });

    expect(hasPendingRuntimeChanges(database, project.id)).toBe(false);
  });
});
