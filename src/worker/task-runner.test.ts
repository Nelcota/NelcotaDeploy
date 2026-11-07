import { describe, expect, test } from "bun:test";

import { listConsoleCommands, runConsoleCommand, updateConsoleCommand } from "@/console";
import { openMemoryDatabase, tables } from "@/db";
import { completeDeployment, requestDeployment, transitionDeployment } from "@/deployments";
import { saveDeploymentSecrets } from "@/environments";
import { taskInputSchema } from "@/shared/schemas/task.schema";
import { createTask, listTaskExecutions, runTask, updateTask } from "@/tasks";
import { createTestProject, createTestSecretBox, FakeDocker, TEST_ACTOR } from "@/testing";

import { runConsoleCommandJob, runTaskExecution } from "./task-runner";

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

const EXEC_OK = { exitCode: 0, stdout: "", stderr: "", timedOut: false, aborted: false };

function consoleSetup() {
  const { database, project, deploymentId } = setup();
  const now = new Date("2026-11-02T12:00:00Z");
  database
    .insert(tables.users)
    .values({ id: "ana", name: "Ana", email: "ana@example.com", createdAt: now, updatedAt: now })
    .run();
  const queued = runConsoleCommand(database, {
    projectId: project.id,
    command: "cat /app/.env | head -1",
    userId: "ana",
    actor: TEST_ACTOR,
  });
  return { database, project, deploymentId, commandId: queued.id };
}

describe("runConsoleCommandJob", () => {
  test("fails a command when its server cannot be prepared, allowing another command", async () => {
    const { database, project, commandId } = consoleSetup();
    using _connection = database.$client;
    const dependencies = {
      database,
      secretBox: await createTestSecretBox(),
      dockerOf: () => {
        throw new Error("The server no longer exists");
      },
    };

    const outcome = await runConsoleCommandJob(
      dependencies,
      commandId,
      new AbortController().signal,
    );

    expect(outcome).toBe("failed");
    expect(listConsoleCommands(database, { projectId: project.id, userId: "ana" })[0]?.status).toBe(
      "failed",
    );
    expect(
      runConsoleCommand(database, {
        projectId: project.id,
        userId: "ana",
        command: "pwd",
        actor: TEST_ACTOR,
      }).status,
    ).toBe("queued");
  });

  test("runs the command through sh -c in the live container and stores its output", async () => {
    const { database, project, commandId } = consoleSetup();
    const docker = new FakeDocker();
    const executed: { reference: string; command: readonly string[] }[] = [];
    docker.execInContainer = async (reference, command, run) => {
      executed.push({ reference, command });
      run.onLine?.("APP_ENV=production", "stdout");
      return await Promise.resolve(EXEC_OK);
    };

    const outcome = await runConsoleCommandJob(
      { database, secretBox: await createTestSecretBox(), dockerOf: () => docker },
      commandId,
      new AbortController().signal,
    );

    expect(outcome).toBe("succeeded");
    expect(executed).toEqual([
      { reference: "live", command: ["sh", "-c", "cat /app/.env | head -1"] },
    ]);
    const [command] = listConsoleCommands(database, { projectId: project.id, userId: "ana" });
    expect(command).toMatchObject({
      status: "succeeded",
      exitCode: 0,
      output: "APP_ENV=production\n",
    });
  });

  test("hides the project's secrets from the output", async () => {
    const { database, project, deploymentId, commandId } = consoleSetup();
    const secretBox = await createTestSecretBox();
    await saveDeploymentSecrets(database, secretBox, { deploymentId, values: ["s3cr3t-value"] });
    const docker = new FakeDocker();
    docker.execInContainer = async (_reference, _command, run) => {
      run.onLine?.("TOKEN=s3cr3t-value", "stdout");
      return await Promise.resolve({ ...EXEC_OK, exitCode: 1 });
    };

    const outcome = await runConsoleCommandJob(
      { database, secretBox, dockerOf: () => docker },
      commandId,
      new AbortController().signal,
    );

    expect(outcome).toBe("failed");
    const [command] = listConsoleCommands(database, { projectId: project.id, userId: "ana" });
    expect(command?.output).toBe("TOKEN=[REDACTED]\n");
    expect(command?.errorMessage).toBe("Command exited with code 1");
  });

  test("skips a command that is no longer waiting", async () => {
    const { database, commandId } = consoleSetup();
    updateConsoleCommand(database, commandId, { status: "failed" });

    const outcome = await runConsoleCommandJob(
      { database, secretBox: await createTestSecretBox(), dockerOf: () => new FakeDocker() },
      commandId,
      new AbortController().signal,
    );

    expect(outcome).toBe("skipped");
  });
});
