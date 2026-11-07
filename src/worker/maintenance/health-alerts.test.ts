import { describe, expect, test } from "bun:test";

import { reconcileHealthAlerts } from "@/alerts";
import { getConfig } from "@/config";
import { createProjectDatabase, markDatabaseRunning } from "@/databases";
import { openMemoryDatabase, tables } from "@/db";
import { completeDeployment, requestDeployment, transitionDeployment } from "@/deployments";
import { databaseContainerNameFor, LABELS } from "@/docker";
import { createLogger } from "@/logging";
import { LOCAL_SERVER_ID, recordServerCheck } from "@/servers";
import { createTestProject, createTestSecretBox, FakeDocker, TEST_ACTOR } from "@/testing";

import { checkHealth } from "./health-alerts";

const NOW = new Date("2026-11-02T12:00:00Z");

async function setup() {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const created = await createProjectDatabase(database, await createTestSecretBox(), {
    projectId: project.id,
    input: { engine: "postgres", environmentKey: "DATABASE_URL" },
    actor: TEST_ACTOR,
  });
  markDatabaseRunning(database, created.id);
  recordServerCheck(database, LOCAL_SERVER_ID, {
    status: "ready",
    message: null,
    dockerVersion: "29",
  });
  const docker = new FakeDocker();
  const dependencies = {
    database,
    hosts: { hostOf: () => ({ docker }) },
    logger: createLogger("test"),
    config: getConfig(),
  };
  const keys = () =>
    database
      .select({ key: tables.healthAlerts.key })
      .from(tables.healthAlerts)
      .all()
      .map((alert) => alert.key);
  return { database, project, created, docker, dependencies, keys };
}

describe("checkHealth", () => {
  test("keeps an application alert when its server becomes unreachable", async () => {
    const { database, project, dependencies, keys } = await setup();
    const projectId = project.id;
    const { deploymentId } = requestDeployment(database, {
      projectId,
      trigger: "manual",
      actor: TEST_ACTOR,
      triggeredByUserId: null,
    });
    for (const to of ["cloning", "building", "starting", "health_checking"] as const) {
      transitionDeployment(database, deploymentId, { to });
    }
    completeDeployment(database, deploymentId);
    const key = `app:${projectId}`;
    reconcileHealthAlerts(database, [{ key, title: "Down", text: "Application stopped" }], {
      now: NOW,
    });
    recordServerCheck(database, LOCAL_SERVER_ID, {
      status: "unreachable",
      message: "Connection lost",
      dockerVersion: null,
    });

    await checkHealth(dependencies);

    expect(keys()).toEqual([key]);
  });

  test("keeps database and disk alerts when their server becomes unreachable", async () => {
    const { database, created, dependencies, keys } = await setup();
    const databaseKey = `database:${created.id}`;
    const diskKey = `disk:${LOCAL_SERVER_ID}`;
    reconcileHealthAlerts(
      database,
      [
        { key: databaseKey, title: "Stopped", text: "Database stopped" },
        { key: diskKey, title: "Full", text: "Disk almost full" },
      ],
      { now: NOW },
    );
    recordServerCheck(database, LOCAL_SERVER_ID, {
      status: "unreachable",
      message: "Connection lost",
      dockerVersion: null,
    });

    await checkHealth(dependencies);

    expect(new Set(keys())).toEqual(new Set([databaseKey, diskKey]));
  });

  test("keeps a database alert when inspecting its container fails", async () => {
    const { database, created, dependencies, keys } = await setup();
    const key = `database:${created.id}`;
    reconcileHealthAlerts(database, [{ key, title: "Stopped", text: "Database stopped" }], {
      now: NOW,
    });
    const hosts = {
      hostOf: () => ({
        docker: {
          inspectContainers: async () => await Promise.reject(new Error("Docker unavailable")),
        },
      }),
    };

    await checkHealth({ ...dependencies, hosts });

    expect(keys()).toEqual([key]);
  });

  test("resolves a database alert after successfully observing the running container", async () => {
    const { database, created, docker, dependencies, keys } = await setup();
    reconcileHealthAlerts(
      database,
      [{ key: `database:${created.id}`, title: "Stopped", text: "Database stopped" }],
      { now: NOW },
    );
    await docker.runContainer(
      {
        containerName: databaseContainerNameFor(created.id),
        imageTag: created.imageTag,
        network: "nelcota",
        labels: { [LABELS.managed]: "true" },
        environmentKeys: [],
        volumes: [],
      },
      {},
    );

    await checkHealth(dependencies);

    expect(keys()).toEqual([]);
  });
});
