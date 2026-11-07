import { expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { completeDeployment, requestDeployment, transitionDeployment } from "@/deployments";
import { saveDeploymentSecrets } from "@/environments";
import { taskInputSchema } from "@/shared/schemas/task.schema";
import { createTask, listTaskExecutions, runTask, updateTask } from "@/tasks";
import { createTestProject, createTestSecretBox, FakeDocker, TEST_ACTOR } from "@/testing";

import { runTaskExecution } from "./task-runner";

function setup() {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const deploymentId = requestDeployment(database, {
    projectId: project.id,
    trigger: "manual",
    actor: TEST_ACTOR,
    triggeredByUserId: null,
  }).deploymentId;
  transitionDeployment(database, deploymentId, {
    to: "starting",
    containerName: "live",
    internalPort: 3000,
  });
  transitionDeployment(database, deploymentId, { to: "health_checking" });
  completeDeployment(database, deploymentId);
  const taskId = createTask(database, {
    projectId: project.id,
    input: taskInputSchema.parse({
      name: "Segredo",
      commandLine: "printenv",
      schedule: "",
      enabled: true,
      timeoutInSeconds: 60,
    }),
    actor: TEST_ACTOR,
    userId: null,
    timeZone: "UTC",
    now: new Date("2026-11-01T12:00:00Z"),
  });
  const executionId = runTask(database, {
    projectId: project.id,
    taskId,
    trigger: "manual",
    actor: TEST_ACTOR,
    userId: null,
  });
  return { database, project, deploymentId, taskId, executionId };
}

test("executes the queued command even when the task is edited before the worker starts", async () => {
  const { database, project, taskId, executionId } = setup();
  using _connection = database.$client;
  updateTask(database, {
    projectId: project.id,
    taskId,
    input: taskInputSchema.parse({
      name: "Changed",
      commandLine: "different-command",
      schedule: "",
      enabled: true,
      timeoutInSeconds: 600,
    }),
    actor: TEST_ACTOR,
    timeZone: "UTC",
  });
  const docker = new FakeDocker();
  const commands: (readonly string[])[] = [];
  const timeouts: number[] = [];
  docker.execInContainer = async (_reference, command, run) => {
    commands.push(command);
    timeouts.push(run.timeoutInMs);
    return await Promise.resolve({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      aborted: false,
    });
  };
  const outcome = await runTaskExecution(
    { database, secretBox: await createTestSecretBox(), dockerOf: () => docker },
    executionId,
    new AbortController().signal,
  );
  expect(outcome).toBe("succeeded");
  expect(commands).toEqual([["printenv"]]);
  expect(timeouts).toEqual([60_000]);
});

test.each([true, false])(
  "redacts old container secrets from task output and errors, snapshot=%p",
  async (withSnapshot) => {
    const { database, project, deploymentId, taskId, executionId } = setup();
    using _connection = database.$client;
    const secretBox = await createTestSecretBox();
    const docker = new FakeDocker();
    const secret = "old-task-secret";
    if (withSnapshot) {
      await saveDeploymentSecrets(database, secretBox, { deploymentId, values: [secret] });
    } else {
      docker.environments.set("live", { TOKEN: secret });
    }
    docker.execInContainer = async (_reference, _command, run) => {
      run.onLine?.(secret, "stdout");
      await Promise.resolve();
      throw new Error(`Execution failed with ${secret}`);
    };

    const outcome = await runTaskExecution(
      { database, secretBox, dockerOf: () => docker },
      executionId,
      new AbortController().signal,
    );

    expect(outcome).toBe("failed");
    const execution = listTaskExecutions(database, { projectId: project.id, taskId, limit: 1 }).at(
      0,
    );
    expect(execution?.output).toBe("[REDACTED]\n");
    expect(execution?.errorMessage).toBe("Execution failed with [REDACTED]");
  },
);
