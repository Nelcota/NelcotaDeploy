import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { getConfig } from "@/config";
import { openMemoryDatabase, tables } from "@/db";
import { getDeployment, requestDeployment } from "@/deployments";
import { claimNextJob } from "@/jobs";
import { createLogger } from "@/logging";
import { createTestProject, createTestSecretBox, TEST_ACTOR } from "@/testing";

import { dispatchJob } from "./job-dispatch";
import { createLocalHost, ServerHosts } from "./servers/server-hosts";

describe("dispatchJob deploy", () => {
  test("fails a deployment whose server was removed instead of leaving it queued", async () => {
    const database = openMemoryDatabase();
    const config = getConfig();
    const project = createTestProject(database);
    const { deploymentId } = requestDeployment(database, {
      projectId: project.id,
      trigger: "manual",
      actor: TEST_ACTOR,
      triggeredByUserId: null,
    });
    database
      .update(tables.deployments)
      .set({ serverId: "removed-server" })
      .where(eq(tables.deployments.id, deploymentId))
      .run();
    const job = claimNextJob(database, "test");
    if (job == null) {
      throw new Error("The deploy job was not queued");
    }
    using hosts = new ServerHosts(createLocalHost(config, "local"), "unused-key");
    const dependencies = {
      workerId: "test",
      database,
      hosts,
      secretBox: await createTestSecretBox(),
      config,
      logger: createLogger("test"),
    };

    const error = await dispatchJob(dependencies, job, {
      signal: new AbortController().signal,
      refreshContainers: async () => await Promise.resolve(),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(getDeployment(database, deploymentId).status).toBe("failed");
  });
});
