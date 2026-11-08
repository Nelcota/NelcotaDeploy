import { expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { requestDeployment } from "@/deployments";
import { listDeploymentLogs } from "@/logs";
import { createRedactor } from "@/secrets";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { DeploymentLogWriter } from "./deployment-log-writer";

test("never stores a credential reconstructed by stripping terminal color sequences", () => {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const { deploymentId } = requestDeployment(database, {
    projectId: project.id,
    trigger: "manual",
    actor: TEST_ACTOR,
    triggeredByUserId: null,
  });
  {
    using logs = new DeploymentLogWriter(database, deploymentId);
    logs.useRedactor(createRedactor(["private-password"]));
    logs.output("password=private-\u001b[31mpassword\u001b[0m", "stdout");
  }
  const stored = listDeploymentLogs(database, deploymentId, { afterId: 0, limit: 10 });
  expect(stored.at(0)?.message).toBe("password=[REDACTED]");
});
