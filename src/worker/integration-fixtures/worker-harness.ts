import { getConfig } from "@/config";
import type { Database } from "@/db";
import { requestDeployment } from "@/deployments";
import { claimNextJob } from "@/jobs";
import { createLogger } from "@/logging";
import { createTestSecretBox, TEST_ACTOR } from "@/testing";

import { dispatchJob } from "../job-dispatch";
import type { WorkerDependencies } from "../worker.types";

/**
 * Builds the worker dependencies for a test database and its server hosts.
 *
 * @param database - Test database.
 * @param hosts - Hosts of the test's servers.
 * @returns What the job dispatcher needs.
 */
export async function createWorkerDependencies(
  database: Database,
  hosts: WorkerDependencies["hosts"],
): Promise<WorkerDependencies> {
  return {
    workerId: "it",
    database,
    hosts,
    secretBox: await createTestSecretBox(),
    config: getConfig(),
    logger: createLogger("remote-it"),
  };
}

/**
 * Queues a deployment and runs its job like the worker does.
 *
 * @param dependencies - Worker dependencies.
 * @param projectId - Project to deploy.
 * @returns The deployment id.
 */
export async function deployThroughQueue(
  dependencies: WorkerDependencies,
  projectId: string,
): Promise<string> {
  const { database } = dependencies;
  const { deploymentId } = requestDeployment(database, {
    projectId,
    trigger: "manual",
    actor: TEST_ACTOR,
    triggeredByUserId: null,
  });
  const job = claimNextJob(database, dependencies.workerId);
  if (job == null) {
    throw new Error("The deploy job was not queued");
  }
  await dispatchJob(dependencies, job, {
    signal: new AbortController().signal,
    refreshContainers: async () => await Promise.resolve(),
  });
  return deploymentId;
}
