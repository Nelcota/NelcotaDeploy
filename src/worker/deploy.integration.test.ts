import { afterAll, describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { eq } from "drizzle-orm";

import { openMemoryDatabase, tables } from "@/db";
import { getDeployment, requestDeployment } from "@/deployments";
import { DockerCli } from "@/docker";
import { GitClient } from "@/git";
import { runProcess } from "@/process";
import { taskInputSchema } from "@/shared/schemas/task.schema";
import { runTask, createTask } from "@/tasks";
import { createTestProject, createTestSecretBox, TEST_ACTOR } from "@/testing";

import { runContainerAction, runProjectCleanup } from "./container-action-runner";
import { type DeployRunnerDependencies, runDeployment } from "./deploy-runner";
import { runTaskExecution } from "./task-runner";

// Builds and runs real containers, so the default `bun run test` ignores it. Run it with:
//   bun run test:docker
const FIXTURE = resolve(import.meta.dir, "../../fixtures/hello-app");
const NETWORK = `nelcota-it-${Date.now()}`;
const TEST_TIMEOUT_IN_MS = 180_000;
const HEALTH_REQUEST_TIMEOUT_IN_MS = 5000;

async function git(args: string[], cwd: string): Promise<void> {
  const result = await runProcess(["git", ...args], {
    cwd,
    timeoutInMs: 30_000,
    env: {
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

describe("deploy cycle with real Docker", () => {
  const docker = new DockerCli("docker");
  const cleanups: (() => Promise<void>)[] = [];

  afterAll(async () => {
    for (const cleanup of cleanups.toReversed()) {
      await cleanup();
    }
  });

  test(
    "deploys a fixture app, controls its container, rolls back and runs a task",
    async () => {
      const repository = await mkdtemp(join(tmpdir(), "nelcota-fixture-"));
      cleanups.push(async () => await rm(repository, { recursive: true, force: true }));
      await cp(FIXTURE, repository, { recursive: true });
      await git(["init", "--initial-branch", "main"], repository);
      await git(["add", "."], repository);
      await git(["commit", "--message", "feat: fixture app"], repository);

      const database = openMemoryDatabase();
      const secretBox = await createTestSecretBox();
      const project = createTestProject(database, {
        slug: `it-${Date.now().toString(36)}`,
        internalPort: 8000,
        healthCheckPath: "/health",
      });
      database
        .update(tables.projects)
        .set({ repositoryUrl: `file://${repository}` })
        .where(eq(tables.projects.id, project.id))
        .run();
      cleanups.push(async () => {
        await runProjectCleanup(database, docker, project.id);
        await runProcess(["docker", "network", "rm", NETWORK], { timeoutInMs: 30_000 });
      });
      const workspaceDir = await mkdtemp(join(tmpdir(), "nelcota-workspaces-"));
      cleanups.push(async () => await rm(workspaceDir, { recursive: true, force: true }));
      const dependencies: DeployRunnerDependencies = {
        database,
        docker,
        git: new GitClient("git"),
        secretBox,
        config: {
          workspaceDir,
          network: NETWORK,
          buildTimeoutInSeconds: 600,
          healthCheckTimeoutInSeconds: 60,
          imagesKeptPerProject: 5,
          traefik: {
            enabled: false,
            httpEntrypoint: "web",
            httpsEntrypoint: "websecure",
            certResolver: "le",
          },
        },
      };
      const deploy = () =>
        requestDeployment(database, {
          projectId: project.id,
          trigger: "manual",
          actor: TEST_ACTOR,
          triggeredByUserId: null,
        }).deploymentId;

      const first = deploy();
      expect(await runDeployment(dependencies, first, new AbortController().signal)).toBe(
        "succeeded",
      );
      const firstDeployment = getDeployment(database, first);
      const container = await docker.inspectContainer(firstDeployment.containerName ?? "");
      expect(container?.running).toBe(true);
      const address = container?.networkAddresses[NETWORK];
      const response = await fetch(`http://${address}:8000/health`, {
        signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_IN_MS),
      });
      expect((await response.text()).trim()).toBe("ok");

      await runContainerAction(database, docker, { deploymentId: first, action: "stop" });
      expect((await docker.inspectContainer(firstDeployment.containerName ?? ""))?.running).toBe(
        false,
      );
      await runContainerAction(database, docker, { deploymentId: first, action: "start" });
      expect((await docker.inspectContainer(firstDeployment.containerName ?? ""))?.running).toBe(
        true,
      );
      await runContainerAction(database, docker, { deploymentId: first, action: "restart" });
      expect((await docker.inspectContainer(firstDeployment.containerName ?? ""))?.running).toBe(
        true,
      );

      const second = deploy();
      expect(await runDeployment(dependencies, second, new AbortController().signal)).toBe(
        "succeeded",
      );
      expect(await docker.inspectContainer(firstDeployment.containerName ?? "")).toBeNull();

      const rollback = requestDeployment(database, {
        projectId: project.id,
        trigger: "rollback",
        actor: TEST_ACTOR,
        triggeredByUserId: null,
        sourceDeploymentId: first,
      }).deploymentId;
      expect(await runDeployment(dependencies, rollback, new AbortController().signal)).toBe(
        "succeeded",
      );
      expect(getDeployment(database, rollback).imageTag).toBe(firstDeployment.imageTag);

      const taskId = createTask(database, {
        projectId: project.id,
        input: taskInputSchema.parse({
          name: "health",
          commandLine: "cat /srv/health",
          schedule: "",
          enabled: true,
          timeoutInSeconds: 30,
        }),
        actor: TEST_ACTOR,
        userId: null,
        timeZone: "UTC",
      });
      const executionId = runTask(database, {
        projectId: project.id,
        taskId,
        trigger: "manual",
        actor: TEST_ACTOR,
        userId: null,
      });
      expect(
        await runTaskExecution(
          { database, docker, secretBox },
          executionId,
          new AbortController().signal,
        ),
      ).toBe("succeeded");
      const execution = database
        .select({ output: tables.taskExecutions.output })
        .from(tables.taskExecutions)
        .where(eq(tables.taskExecutions.id, executionId))
        .get();
      expect(execution?.output.trim()).toBe("ok");
    },
    TEST_TIMEOUT_IN_MS,
  );
});
