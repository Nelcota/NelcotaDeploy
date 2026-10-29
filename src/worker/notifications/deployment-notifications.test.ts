import { describe, expect, test } from "bun:test";

import pino from "pino";

import { getConfig } from "@/config";
import { openMemoryDatabase } from "@/db";
import { completeDeployment, requestDeployment, transitionDeployment } from "@/deployments";
import { saveGitHubApp } from "@/github";
import { createTestProject, createTestSecretBox, TEST_ACTOR } from "@/testing";

import { reportDeploymentStatus } from "./deployment-notifications";

const SHA = "b".repeat(40);

/** A panel whose GitHub App has a broken key, so every attempt to publish fails. */
async function setup() {
  const database = openMemoryDatabase();
  const secretBox = await createTestSecretBox();
  await saveGitHubApp(database, secretBox, {
    app: {
      id: 1,
      slug: "nelcota",
      name: "Nelcota",
      html_url: "https://github.com/apps/nelcota",
      owner: { login: "acme" },
      pem: "-----BEGIN RSA PRIVATE KEY-----\nbroken\n-----END RSA PRIVATE KEY-----\n",
      webhook_secret: null,
      client_id: "Iv1.abc",
      client_secret: "client-secret",
    },
    actor: TEST_ACTOR,
  });
  const warnings: string[] = [];
  const logger = pino({ level: "warn" }, { write: (line: string) => warnings.push(line) });
  const dependencies = { database, secretBox, config: getConfig(), logger };
  const project = createTestProject(database);
  return { database, dependencies, project, warnings };
}

describe("reportDeploymentStatus", () => {
  test("logs a failure to publish instead of throwing", async () => {
    const { database, dependencies, project, warnings } = await setup();
    const { deploymentId } = requestDeployment(database, {
      projectId: project.id,
      trigger: "webhook",
      actor: TEST_ACTOR,
      triggeredByUserId: null,
      commitSha: SHA,
    });

    await reportDeploymentStatus(dependencies, deploymentId, "pending");

    expect(warnings.join("")).toContain("could not publish the commit status");
  });

  test("skips a deployment whose commit is not known yet", async () => {
    const { database, dependencies, project, warnings } = await setup();
    const { deploymentId } = requestDeployment(database, {
      projectId: project.id,
      trigger: "manual",
      actor: TEST_ACTOR,
      triggeredByUserId: null,
    });

    await reportDeploymentStatus(dependencies, deploymentId, "pending");

    expect(warnings).toEqual([]);
  });
});

describe("reportDeploymentStatus for redeploys", () => {
  test("skips a redeploy, which says nothing new about the commit", async () => {
    const { database, dependencies, project, warnings } = await setup();
    const manual = { projectId: project.id, actor: TEST_ACTOR, triggeredByUserId: null };
    const first = requestDeployment(database, { ...manual, trigger: "manual", commitSha: SHA });
    transitionDeployment(database, first.deploymentId, { to: "cloning" });
    transitionDeployment(database, first.deploymentId, { to: "building", commitSha: SHA });
    transitionDeployment(database, first.deploymentId, {
      to: "starting",
      imageTag: "nelcota/api:abc",
      containerName: "nelcota-api-abc",
    });
    transitionDeployment(database, first.deploymentId, { to: "health_checking" });
    completeDeployment(database, first.deploymentId);
    const redeploy = requestDeployment(database, {
      ...manual,
      trigger: "redeploy",
      sourceDeploymentId: first.deploymentId,
    });

    await reportDeploymentStatus(dependencies, redeploy.deploymentId, "pending");

    expect(warnings).toEqual([]);
  });
});
