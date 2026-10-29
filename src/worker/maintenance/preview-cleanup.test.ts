import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";
import pino from "pino";

import { type Database, openMemoryDatabase, tables } from "@/db";
import { requestDeployment } from "@/deployments";
import { managedLabels } from "@/docker";
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
    );

    expect([...docker.containers.keys()]).toEqual(["production"]);
    expect(routeCommands).toEqual([["rm", "-f", "--", `/routes/${project.id}-pr-12.yml`]]);
  });
});
