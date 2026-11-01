import { expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { getDeployment, requestDeployment } from "@/deployments";
import { createLogger } from "@/logging";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { handleRecoveredJobs } from "./job-recovery";

test("marks an interrupted queued deployment failed when its retry allowance is exhausted", () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const project = createTestProject(database);
  const deploymentId = requestDeployment(database, {
    projectId: project.id,
    trigger: "manual",
    actor: TEST_ACTOR,
    triggeredByUserId: null,
  }).deploymentId;

  handleRecoveredJobs(database, createLogger("test"), [
    { id: "job", kind: "deploy", deploymentId, taskExecutionId: null, outcome: "failed" },
  ]);

  expect(getDeployment(database, deploymentId).status).toBe("failed");
});
