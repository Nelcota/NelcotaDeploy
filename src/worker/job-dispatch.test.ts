import { describe, expect, spyOn, test } from "bun:test";

import { eq } from "drizzle-orm";

import { getConfig } from "@/config";
import { openMemoryDatabase, tables } from "@/db";
import {
  completeDeployment,
  getDeployment,
  requestContainerAction,
  requestDeployment,
  transitionDeployment,
} from "@/deployments";
import { claimNextJob, enqueueJob, JobLeaseLostError } from "@/jobs";
import { createLogger } from "@/logging";
import { createTestProject, createTestSecretBox, FakeDocker, TEST_ACTOR } from "@/testing";

import { dispatchJob } from "./job-dispatch";
import { ServerHosts } from "./servers/server-hosts";

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
    using hosts = new ServerHosts(config, "unused-key");
    const dependencies = {
      workerId: "test",
      database,
      hosts,
      secretBox: await createTestSecretBox(),
      config,
      logger: createLogger("test"),
      offsiteStore: null,
    };

    const error = await dispatchJob(dependencies, job, {
      signal: new AbortController().signal,
      refreshContainers: async () => await Promise.resolve(),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(getDeployment(database, deploymentId).status).toBe("failed");
  });
});

test.each(["project_cleanup", "database_delete", "task_run"] as const)(
  "refuses side effects of an unowned %s job",
  async (kind) => {
    const database = openMemoryDatabase();
    const config = getConfig();
    const project = createTestProject(database);
    enqueueJob(database, { projectId: project.id, kind });
    const job = claimNextJob(database, "previous-worker");
    if (job == null) {
      throw new Error("Expected a job");
    }
    using hosts = new ServerHosts(config, "unused-key");
    const failure = await dispatchJob(
      {
        workerId: "previous-worker",
        database,
        config,
        hosts,
        secretBox: await createTestSecretBox(),
        logger: createLogger("test"),
        offsiteStore: null,
      },
      job,
      {
        signal: new AbortController().signal,
        assertOwnership: () => {
          throw new JobLeaseLostError(job.id);
        },
        refreshContainers: () => Promise.resolve(),
      },
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JobLeaseLostError);
    expect(
      database.$client.query("SELECT id FROM projects WHERE id = ?").get(project.id),
    ).not.toBeNull();
  },
);

test.each(["start", "stop", "restart"] as const)(
  "a queued %s controls the new live container after a deploy",
  async (action) => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const config = getConfig();
    const project = createTestProject(database);
    const makeLive = (deploymentId: string, containerName: string) => {
      transitionDeployment(database, deploymentId, { to: "starting", containerName });
      transitionDeployment(database, deploymentId, { to: "health_checking" });
      completeDeployment(database, deploymentId);
    };
    const request = {
      projectId: project.id,
      trigger: "manual" as const,
      actor: TEST_ACTOR,
      triggeredByUserId: null,
    };
    const first = requestDeployment(database, request).deploymentId;
    makeLive(first, "removed-container");
    const next = requestDeployment(database, request).deploymentId;
    const { jobId } = requestContainerAction(database, {
      projectId: project.id,
      action,
      actor: TEST_ACTOR,
    });
    makeLive(next, "new-live-container");
    const job = database.select().from(tables.jobs).where(eq(tables.jobs.id, jobId)).get();
    if (job == null) {
      throw new Error("Container action was not queued");
    }
    using hosts = new ServerHosts(config, "unused-key");
    const docker = hosts.hostOf(database, project.serverId).docker;
    const fakeDocker = new FakeDocker();
    await fakeDocker.runContainer(
      {
        containerName: "new-live-container",
        imageTag: "nelcota/api:test",
        network: "nelcota",
        labels: { "io.nelcota.managed": "true", "io.nelcota.deployment-id": next },
        environmentKeys: [],
        volumes: [],
      },
      {},
    );
    const listing = spyOn(docker, "listManagedContainers").mockResolvedValue(
      await fakeDocker.listManagedContainers(),
    );
    using _listing = { [Symbol.dispose]: () => listing.mockRestore() };
    const method = {
      start: "startContainer",
      stop: "stopContainer",
      restart: "restartContainer",
    } as const;
    const control = spyOn(docker, method[action]).mockResolvedValue();
    using _control = { [Symbol.dispose]: () => control.mockRestore() };

    await dispatchJob(
      {
        workerId: "test",
        database,
        hosts,
        secretBox: await createTestSecretBox(),
        config,
        logger: createLogger("test"),
        offsiteStore: null,
      },
      job,
      {
        signal: new AbortController().signal,
        refreshContainers: () => Promise.resolve(),
      },
    );

    expect(control).toHaveBeenCalledWith("new-live-container");
  },
);
describe("dispatchJob console_command", () => {
  test("fails a console job that names no command", async () => {
    const database = openMemoryDatabase();
    const config = getConfig();
    const project = createTestProject(database);
    enqueueJob(database, { kind: "console_command", projectId: project.id, payload: {} });
    const job = claimNextJob(database, "test");
    if (job == null) {
      throw new Error("The console job was not queued");
    }
    using hosts = new ServerHosts(config, "unused-key");
    const dependencies = {
      workerId: "test",
      database,
      hosts,
      secretBox: await createTestSecretBox(),
      config,
      logger: createLogger("test"),
      offsiteStore: null,
    };

    const error = await dispatchJob(dependencies, job, {
      signal: new AbortController().signal,
      refreshContainers: async () => await Promise.resolve(),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
  });
});
