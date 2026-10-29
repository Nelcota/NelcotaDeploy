import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Database, openMemoryDatabase } from "@/db";
import { getDeployment, requestDeployment } from "@/deployments";
import { saveEnvironmentVariable } from "@/environments";
import { listDeploymentLogs } from "@/logs";
import { createTestProject, createTestSecretBox, FakeDocker, TEST_ACTOR } from "@/testing";

import { runDeployment } from "./deploy-runner";

type DeployRunnerDependencies = Parameters<typeof runDeployment>[0];
type CloneOptions = Parameters<DeployRunnerDependencies["git"]["checkoutRevision"]>[0];

const fakeGit = {
  async checkoutRevision(options: CloneOptions) {
    await mkdir(options.directory, { recursive: true });
    await writeFile(join(options.directory, "Dockerfile"), "FROM scratch\n");
    return { sha: "c0ffee".padEnd(40, "0"), message: "feat: initial" };
  },
};

const alwaysHealthy = {
  http: async () => await Promise.resolve(true),
  tcp: async () => await Promise.resolve(true),
};
const neverHealthy = {
  http: async () => await Promise.resolve(false),
  tcp: async () => await Promise.resolve(false),
};

async function setup(options: { probes?: typeof alwaysHealthy; healthTimeout?: number } = {}) {
  const database = openMemoryDatabase();
  const docker = new FakeDocker();
  const secretBox = await createTestSecretBox();
  const project = createTestProject(database);
  const dependencies: DeployRunnerDependencies = {
    database,
    docker,
    git: fakeGit,
    secretBox,
    probes: options.probes ?? alwaysHealthy,
    config: {
      workspaceDir: await mkdtemp(join(tmpdir(), "nelcota-test-")),
      network: "nelcota-test",
      buildTimeoutInSeconds: 60,
      healthCheckTimeoutInSeconds: options.healthTimeout ?? 10,
      imagesKeptPerProject: 2,
      traefik: {
        enabled: true,
        httpEntrypoint: "web",
        httpsEntrypoint: "websecure",
        certResolver: "le",
      },
    },
  };
  return { database, docker, secretBox, project, dependencies };
}

function deploy(database: Database, projectId: string): string {
  return requestDeployment(database, {
    projectId,
    trigger: "manual",
    actor: TEST_ACTOR,
    triggeredByUserId: null,
  }).deploymentId;
}

function logText(database: Database, deploymentId: string): string {
  return listDeploymentLogs(database, deploymentId, { afterId: 0, limit: 1000 })
    .map((line) => line.message)
    .join("\n");
}

describe("runDeployment success", () => {
  test("builds, starts and health checks a new deployment", async () => {
    const { database, docker, project, dependencies } = await setup();
    const deploymentId = deploy(database, project.id);

    const status = await runDeployment(dependencies, deploymentId, new AbortController().signal);

    expect(status).toBe("succeeded");
    const deployment = getDeployment(database, deploymentId);
    expect(deployment.status).toBe("succeeded");
    expect(deployment.commitSha).toStartWith("c0ffee");
    expect(docker.calls.some((call) => call.startsWith("build nelcota/api:"))).toBe(true);
    expect(docker.containers.size).toBe(1);
  }, 15_000);

  test("replaces the previous container after the new one is healthy", async () => {
    const { database, docker, project, dependencies } = await setup();
    await runDeployment(dependencies, deploy(database, project.id), new AbortController().signal);
    const [firstContainer] = docker.containers.keys();

    await runDeployment(dependencies, deploy(database, project.id), new AbortController().signal);

    expect(docker.containers.size).toBe(1);
    expect(docker.containers.has(firstContainer ?? "")).toBe(false);
  }, 20_000);

  test("passes variables to the container by name and redacts secrets from logs", async () => {
    const { database, docker, project, dependencies, secretBox } = await setup();
    docker.buildFailure = "token is super-secret-value";
    await saveEnvironmentVariable(database, secretBox, {
      projectId: project.id,
      input: {
        key: "API_TOKEN",
        kind: "secret",
        value: "super-secret-value",
        availableAtBuild: true,
      },
      actor: TEST_ACTOR,
    });
    const deploymentId = deploy(database, project.id);

    await runDeployment(dependencies, deploymentId, new AbortController().signal);

    const logs = logText(database, deploymentId);
    expect(logs).not.toContain("super-secret-value");
    expect(logs).toContain("[REDACTED]");
    expect(getDeployment(database, deploymentId).errorMessage).not.toContain("super-secret-value");
  }, 15_000);
});

describe("runDeployment failures", () => {
  test("marks the deployment failed and keeps the previous container when the build fails", async () => {
    const { database, docker, project, dependencies } = await setup();
    await runDeployment(dependencies, deploy(database, project.id), new AbortController().signal);
    const previousContainers = [...docker.containers.keys()];
    docker.buildFailure = "ERROR: failed to solve: process did not complete";
    const deploymentId = deploy(database, project.id);

    const status = await runDeployment(dependencies, deploymentId, new AbortController().signal);

    expect(status).toBe("failed");
    expect(getDeployment(database, deploymentId).errorMessage).toContain("docker build failed");
    expect([...docker.containers.keys()]).toEqual(previousContainers);
    expect(logText(database, deploymentId)).toContain("failed to solve");
  }, 15_000);

  test("removes the new container when the health check fails", async () => {
    const { database, docker, project, dependencies } = await setup({
      probes: neverHealthy,
      healthTimeout: 2,
    });
    const deploymentId = deploy(database, project.id);

    const status = await runDeployment(dependencies, deploymentId, new AbortController().signal);

    expect(status).toBe("failed");
    expect(docker.containers.size).toBe(0);
    expect(logText(database, deploymentId)).toContain("app crashed");
  }, 15_000);

  test("fails when the container exits right after starting", async () => {
    const { database, docker, project, dependencies } = await setup();
    docker.containersStayUp = false;
    const deploymentId = deploy(database, project.id);

    const status = await runDeployment(dependencies, deploymentId, new AbortController().signal);

    expect(status).toBe("failed");
    expect(getDeployment(database, deploymentId).errorMessage).toContain("stopped");
  }, 15_000);
});
