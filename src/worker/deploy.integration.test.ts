import { afterAll, describe, expect, test } from "bun:test";

import { getDeployment, requestDeployment } from "@/deployments";
import { taskInputSchema } from "@/shared/schemas/task.schema";
import { createTask, listTaskExecutions, runTask } from "@/tasks";

import { runContainerAction } from "./container-action-runner";
import { runDeployment } from "./deploy/deploy-runner";
import { createFixtureEnvironment, FIXTURE_PORT } from "./integration-fixtures/fixture-environment";
import { type Cleanup, runCleanupsInReverse } from "./integration-fixtures/fixture-host";
import { runTaskExecution } from "./task-runner";

// Builds and runs real containers, so the default `bun run test` ignores it. Run it with:
//   bun run test:docker
const NETWORK = `nelcota-it-${Date.now()}`;
const CLEANUP_TIMEOUT_IN_MS = 120_000;
const TEST_TIMEOUT_IN_MS = 180_000;
const HEALTH_REQUEST_TIMEOUT_IN_MS = 5000;

type FixtureEnvironment = Awaited<ReturnType<typeof createFixtureEnvironment>>;

async function deploy(
  environment: FixtureEnvironment,
  sourceDeploymentId: string | null = null,
): Promise<string> {
  const { deploymentId } = requestDeployment(environment.database, {
    projectId: environment.project.id,
    trigger: sourceDeploymentId == null ? "manual" : "rollback",
    actor: environment.actor,
    triggeredByUserId: null,
    sourceDeploymentId,
  });
  const status = await runDeployment(
    environment.dependencies,
    deploymentId,
    new AbortController().signal,
  );
  expect(status).toBe("succeeded");
  return deploymentId;
}

async function isRunning(environment: FixtureEnvironment, containerName: string): Promise<boolean> {
  const container = await environment.docker.inspectContainer(containerName);
  return container?.running === true;
}

async function expectAnswersOnHealth(
  environment: FixtureEnvironment,
  containerName: string,
): Promise<void> {
  const container = await environment.docker.inspectContainer(containerName);
  expect(container?.running).toBe(true);
  const address = container?.networkAddresses[NETWORK];
  const response = await fetch(`http://${address}:${FIXTURE_PORT}/health`, {
    signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_IN_MS),
  });
  expect((await response.text()).trim()).toBe("ok");
}

async function expectContainerActionsWork(
  environment: FixtureEnvironment,
  deploymentId: string,
  containerName: string,
): Promise<void> {
  const { database, docker } = environment;
  await runContainerAction(database, docker, { deploymentId, action: "stop" });
  expect(await isRunning(environment, containerName)).toBe(false);
  await runContainerAction(database, docker, { deploymentId, action: "start" });
  expect(await isRunning(environment, containerName)).toBe(true);
  await runContainerAction(database, docker, { deploymentId, action: "restart" });
  expect(await isRunning(environment, containerName)).toBe(true);
}

async function runHealthTask(environment: FixtureEnvironment): Promise<string> {
  const { database, docker, secretBox, project, actor } = environment;
  const taskId = createTask(database, {
    projectId: project.id,
    input: taskInputSchema.parse({
      name: "health",
      commandLine: "cat /srv/health",
      schedule: "",
      enabled: true,
      timeoutInSeconds: 30,
    }),
    actor,
    userId: null,
    timeZone: "UTC",
  });
  const executionId = runTask(database, {
    projectId: project.id,
    taskId,
    trigger: "manual",
    actor,
    userId: null,
  });
  const signal = new AbortController().signal;
  const status = await runTaskExecution(
    { database, dockerOf: () => docker, secretBox },
    executionId,
    signal,
  );
  expect(status).toBe("succeeded");
  const [execution] = listTaskExecutions(database, { projectId: project.id, taskId, limit: 1 });
  return execution?.output.trim() ?? "";
}

describe("deploy cycle with real Docker", () => {
  const cleanups: Cleanup[] = [];

  // Removing the containers and images outlasts the default 5 s hook timeout on CI runners.
  afterAll(async () => {
    await runCleanupsInReverse(cleanups);
  }, CLEANUP_TIMEOUT_IN_MS);

  test(
    "deploys a fixture app, controls its container, rolls back and runs a task",
    async () => {
      const environment = await createFixtureEnvironment(NETWORK, cleanups);

      const first = await deploy(environment);
      const firstDeployment = getDeployment(environment.database, first);
      const firstContainer = firstDeployment.containerName ?? "";
      await expectAnswersOnHealth(environment, firstContainer);
      await expectContainerActionsWork(environment, first, firstContainer);
      await deploy(environment);
      // The second deploy replaced the first container.
      expect(await environment.docker.inspectContainer(firstContainer)).toBeNull();
      const rollback = await deploy(environment, first);
      const taskOutput = await runHealthTask(environment);

      expect(getDeployment(environment.database, rollback).imageTag).toBe(firstDeployment.imageTag);
      expect(taskOutput).toBe("ok");
    },
    TEST_TIMEOUT_IN_MS,
  );
});
