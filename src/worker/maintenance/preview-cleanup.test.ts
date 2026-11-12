import { describe, expect, spyOn, test } from "bun:test";

import { eq } from "drizzle-orm";
import pino from "pino";

import { type Database, openMemoryDatabase, tables } from "@/db";
import { requestDeployment } from "@/deployments";
import { managedLabels } from "@/docker";
import { JobLeaseLostError } from "@/jobs";
import { closePreview, openPreview } from "@/previews";
import { RouteFiles } from "@/routing";
import { createTestProject, FakeDocker, TEST_ACTOR } from "@/testing";

import { runPreviewCleanupJob } from "./preview-cleanup";

async function runContainer(
  docker: FakeDocker,
  labels: { readonly projectId: string; readonly previewId: string | null; readonly name: string },
): Promise<void> {
  await docker.runContainer(
    {
      containerName: labels.name,
      imageTag: `nelcota/api:${labels.name}`,
      network: "nelcota",
      labels: managedLabels({
        projectId: labels.projectId,
        projectSlug: "api",
        deploymentId: labels.name,
        previewId: labels.previewId,
      }),
      environmentKeys: [],
      volumes: [],
    },
    {},
  );
}

/** Route files that record their commands instead of touching a server. */
function recordingRoutes() {
  const routeCommands: (readonly string[])[] = [];
  const routes = new RouteFiles(async (command) => {
    routeCommands.push(command);
    return await Promise.resolve({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      aborted: false,
    });
  }, "/routes");
  return { routes, routeCommands };
}

function queuedCleanup(database: Database) {
  const cleanup = database
    .select()
    .from(tables.jobs)
    .where(eq(tables.jobs.kind, "preview_cleanup"))
    .get();
  if (cleanup == null) {
    throw new Error("the cleanup job was not queued");
  }
  return cleanup;
}

function closedPreviewFixture() {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const target = { projectId: project.id, number: 12, branch: "feature", headSha: "a".repeat(40) };
  const previewId = openPreview(database, target);
  closePreview(database, target);
  return { database, target, previewId, job: queuedCleanup(database) };
}

describe("runPreviewCleanupJob", () => {
  test("removes the closed preview's routes and container, and leaves production alone", async () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const previewId = openPreview(database, {
      projectId: project.id,
      number: 12,
      branch: "feature",
      headSha: "a".repeat(40),
    });
    // The preview ran on the project's server once.
    requestDeployment(database, {
      projectId: project.id,
      trigger: "manual",
      actor: TEST_ACTOR,
      triggeredByUserId: null,
      previewId,
    });
    closePreview(database, { projectId: project.id, number: 12 });
    const docker = new FakeDocker();
    await runContainer(docker, { projectId: project.id, previewId: null, name: "production" });
    await runContainer(docker, { projectId: project.id, previewId, name: "preview" });
    const { routes, routeCommands } = recordingRoutes();
    const cleanup = queuedCleanup(database);

    await runPreviewCleanupJob(
      {
        database,
        logger: pino({ level: "silent" }),
        hosts: { hostsOf: () => [{ docker, routes }] },
      },
      cleanup,
      () => undefined,
    );

    expect([...docker.containers.keys()]).toEqual(["production"]);
    expect(routeCommands).toEqual([["rm", "-f", "--", `/routes/${project.id}-pr-12.yml`]]);
  });

  test("waits for an in-flight host cleanup when another host fails", async () => {
    const { database, job } = closedPreviewFixture();
    using _connection = database.$client;
    const failure = new Error("first server unavailable");
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    using _finish = { [Symbol.dispose]: () => finish.resolve() };
    const failingRoutes = new RouteFiles(() => Promise.reject(failure), "/routes");
    const waitingRoutes = new RouteFiles(async () => {
      started.resolve();
      await finish.promise;
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false, aborted: false };
    }, "/routes");
    let settled = false;
    const outcome = runPreviewCleanupJob(
      {
        database,
        logger: pino({ level: "silent" }),
        hosts: {
          hostsOf: () => [
            { docker: new FakeDocker(), routes: failingRoutes },
            { docker: new FakeDocker(), routes: waitingRoutes },
          ],
        },
      },
      job,
      () => undefined,
    )
      .catch((error: unknown) => error)
      .finally(() => {
        settled = true;
      });
    await started.promise;

    await Bun.sleep(0);

    expect(settled).toBe(false);
    finish.resolve();
    expect(await outcome).toBe(failure);
  });

  test("does not remove containers after losing the job lease during inventory", async () => {
    const { database, previewId, job } = closedPreviewFixture();
    using _connection = database.$client;
    const docker = new FakeDocker();
    await runContainer(docker, { projectId: job.projectId, previewId, name: "preview" });
    const containers = await docker.listManagedContainers();
    let owned = true;
    const inventory = spyOn(docker, "listManagedContainers").mockImplementation(() => {
      owned = false;
      return Promise.resolve(containers);
    });
    using _inventory = { [Symbol.dispose]: () => inventory.mockRestore() };

    const result = await runPreviewCleanupJob(
      {
        database,
        logger: pino({ level: "silent" }),
        hosts: { hostsOf: () => [{ docker, routes: null }] },
      },
      job,
      () => {
        if (owned === false) {
          throw new JobLeaseLostError(job.id);
        }
      },
    ).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(JobLeaseLostError);
    expect(docker.containers.has("preview")).toBe(true);
  });

  test("leaves the current resources alone if the preview reopened before cleanup", async () => {
    const { database, target, previewId, job } = closedPreviewFixture();
    using _connection = database.$client;
    openPreview(database, target);
    const docker = new FakeDocker();
    await runContainer(docker, { projectId: job.projectId, previewId, name: "preview" });
    const { routes, routeCommands } = recordingRoutes();

    await runPreviewCleanupJob(
      {
        database,
        logger: pino({ level: "silent" }),
        hosts: { hostsOf: () => [{ docker, routes }] },
      },
      job,
      () => undefined,
    );

    expect(docker.containers.has("preview")).toBe(true);
    expect(routeCommands).toEqual([]);
  });
});
