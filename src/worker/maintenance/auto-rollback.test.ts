import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { getConfig } from "@/config";
import { type Database, openMemoryDatabase, tables } from "@/db";
import { getDeployment, listDeployments } from "@/deployments";
import { createLogger } from "@/logging";
import { replaceContainerSnapshots } from "@/monitoring";
import { createTestProject } from "@/testing";

import { rollBackRestartLoops } from "./auto-rollback";

const NOW = new Date("2026-11-02T12:00:00Z");
const MINUTE_IN_MS = 60_000;

function insertDeployment(
  database: Database,
  projectId: string,
  values: { readonly finishedMinutesAgo: number; readonly trigger?: "manual" | "auto-rollback" },
): string {
  const id = crypto.randomUUID();
  const finishedAt = new Date(NOW.getTime() - values.finishedMinutesAgo * MINUTE_IN_MS);
  database
    .insert(tables.deployments)
    .values({
      id,
      projectId,
      trigger: values.trigger ?? "manual",
      triggeredByLabel: "test",
      branch: "main",
      status: "succeeded",
      commitSha: "a".repeat(40),
      imageTag: `nelcota/api:${id.slice(0, 8)}`,
      internalPort: 3000,
      createdAt: new Date(finishedAt.getTime() - MINUTE_IN_MS).toISOString(),
      finishedAt: finishedAt.toISOString(),
    })
    .run();
  return id;
}

function goLive(database: Database, projectId: string, deploymentId: string): void {
  database
    .update(tables.projects)
    .set({ currentDeploymentId: deploymentId })
    .where(eq(tables.projects.id, projectId))
    .run();
}

function observeRestarts(
  database: Database,
  target: { readonly projectId: string; readonly deploymentId: string },
  restartCounts: readonly number[],
): void {
  replaceContainerSnapshots(
    database,
    "local",
    restartCounts.map((restartCount, index) => ({
      containerId: `container-${index}`,
      projectId: target.projectId,
      deploymentId: target.deploymentId,
      name: `nelcota-api-${index}`,
      image: "nelcota/api",
      state: "running",
      health: null,
      restartCount,
      startedAt: NOW.toISOString(),
      observedAt: NOW.toISOString(),
    })),
  );
}

function setup(
  options: { readonly windowInMinutes?: number; readonly autoRollback?: boolean } = {},
) {
  const database = openMemoryDatabase();
  const project = createTestProject(database, { autoRollback: options.autoRollback ?? true });
  const previous = insertDeployment(database, project.id, { finishedMinutesAgo: 60 });
  const current = insertDeployment(database, project.id, { finishedMinutesAgo: 2 });
  goLive(database, project.id, current);
  const dependencies = {
    database,
    logger: createLogger("test"),
    config: { ...getConfig(), AUTO_ROLLBACK_WINDOW_MINUTES: options.windowInMinutes ?? 5 },
  };
  return { database, project, previous, current, dependencies };
}

function autoRollbacks(database: Database, projectId: string) {
  return listDeployments(database, { projectId, limit: 10 }).filter(
    (deployment) => deployment.trigger === "auto-rollback",
  );
}

describe("rollBackRestartLoops", () => {
  test("rolls back to the previous version when a replica restarted three times", async () => {
    const { database, project, previous, current, dependencies } = setup();
    observeRestarts(database, { projectId: project.id, deploymentId: current }, [0, 3]);

    await rollBackRestartLoops(dependencies, NOW);

    const [rollback] = autoRollbacks(database, project.id);
    expect(rollback?.sourceDeploymentId).toBe(previous);
    expect(getDeployment(database, current).autoRolledBackAt).toBe(NOW.toISOString());
  });

  test("rolls back only once", async () => {
    const { database, project, current, dependencies } = setup();
    observeRestarts(database, { projectId: project.id, deploymentId: current }, [5]);

    await rollBackRestartLoops(dependencies, NOW);
    await rollBackRestartLoops(dependencies, NOW);

    expect(autoRollbacks(database, project.id)).toHaveLength(1);
  });

  test("leaves a version that restarted fewer than three times", async () => {
    const { database, project, current, dependencies } = setup();
    observeRestarts(database, { projectId: project.id, deploymentId: current }, [2]);

    await rollBackRestartLoops(dependencies, NOW);

    expect(autoRollbacks(database, project.id)).toEqual([]);
  });

  test("leaves a version that went live before the watch window", async () => {
    const { database, project, current, dependencies } = setup({ windowInMinutes: 1 });
    observeRestarts(database, { projectId: project.id, deploymentId: current }, [9]);

    await rollBackRestartLoops(dependencies, NOW);

    expect(autoRollbacks(database, project.id)).toEqual([]);
  });

  test("never rolls back a rollback it made, so a broken old version cannot loop", async () => {
    const { database, project, dependencies } = setup();
    const rollback = insertDeployment(database, project.id, {
      finishedMinutesAgo: 1,
      trigger: "auto-rollback",
    });
    goLive(database, project.id, rollback);
    observeRestarts(database, { projectId: project.id, deploymentId: rollback }, [9]);

    await rollBackRestartLoops(dependencies, NOW);

    expect(autoRollbacks(database, project.id).map((deployment) => deployment.id)).toEqual([
      rollback,
    ]);
  });

  test("leaves a project that turned automatic rollbacks off", async () => {
    const { database, project, current, dependencies } = setup({ autoRollback: false });
    observeRestarts(database, { projectId: project.id, deploymentId: current }, [9]);

    await rollBackRestartLoops(dependencies, NOW);

    expect(autoRollbacks(database, project.id)).toEqual([]);
  });

  test("does nothing when the watch window is zero", async () => {
    const { database, project, current, dependencies } = setup({ windowInMinutes: 0 });
    observeRestarts(database, { projectId: project.id, deploymentId: current }, [9]);

    await rollBackRestartLoops(dependencies, NOW);

    expect(autoRollbacks(database, project.id)).toEqual([]);
  });

  test("records the loop once when there is no earlier version to go back to", async () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const only = insertDeployment(database, project.id, { finishedMinutesAgo: 2 });
    goLive(database, project.id, only);
    observeRestarts(database, { projectId: project.id, deploymentId: only }, [4]);
    const dependencies = { database, logger: createLogger("test"), config: getConfig() };

    await rollBackRestartLoops(dependencies, NOW);

    expect(autoRollbacks(database, project.id)).toEqual([]);
    const skippedAt = database
      .select({ skippedAt: tables.deployments.autoRollbackSkippedAt })
      .from(tables.deployments)
      .where(eq(tables.deployments.id, only))
      .get()?.skippedAt;
    expect(skippedAt).toBe(NOW.toISOString());
  });
});
