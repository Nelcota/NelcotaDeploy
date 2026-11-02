import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";

import { openMemoryDatabase } from "@/db";
import { getDeployment, requestDeployment } from "@/deployments";
import { saveEnvironmentVariable } from "@/environments";
import { runProcess } from "@/process";
import {
  createTestProject,
  createTestSecretBox,
  FakeDocker,
  fromShellPath,
  TEST_ACTOR,
  toShellPath,
} from "@/testing";

import { runDeployment } from "../deploy-runner";

type Dependencies = Parameters<typeof runDeployment>[0];
type CloneOptions = Parameters<Dependencies["git"]["checkoutRevision"]>[0];

const COMPOSE_FILE = "services:\n  web:\n    build: .\n  db:\n    image: postgres:18\n";

/** Clones a repository holding a Compose file and a Dockerfile. */
const fakeGit = {
  async checkoutRevision(options: CloneOptions) {
    await Bun.write(fromShellPath(`${options.directory}/compose.yaml`), COMPOSE_FILE);
    await Bun.write(fromShellPath(`${options.directory}/Dockerfile`), "FROM scratch\n");
    return { sha: "c0ffee".padEnd(40, "0"), message: "feat: compose" };
  },
};

/** What `docker compose config` prints for {@link COMPOSE_FILE} in the given folder. */
function renderedModel(web: Record<string, unknown> = {}) {
  return (directory: string) => ({
    services: {
      web: {
        build: { context: directory, dockerfile: "Dockerfile" },
        networks: { default: null },
        ...web,
      },
      db: { image: "postgres:18", networks: { default: null } },
    },
    networks: { default: {} },
    volumes: {},
  });
}

async function setup(web: Record<string, unknown> = {}) {
  const database = openMemoryDatabase();
  const docker = new FakeDocker();
  docker.compose.model = renderedModel(web);
  const project = createTestProject(database, {
    builder: "compose",
    composeFilePath: "compose.yaml",
    composeService: "web",
    internalPort: 8080,
  });
  const secretBox = await createTestSecretBox();
  await saveEnvironmentVariable(database, secretBox, {
    projectId: project.id,
    input: {
      key: "API_TOKEN",
      kind: "secret",
      value: "super-secret-value",
      availableAtBuild: false,
      excludeFromPreviews: false,
    },
    actor: TEST_ACTOR,
  });
  const dependencies: Dependencies = {
    database,
    runner: runProcess,
    docker,
    git: fakeGit,
    secretBox,
    probes: {
      http: async () => await Promise.resolve(true),
      tcp: async () => await Promise.resolve(true),
    },
    config: {
      workspaceDir: toShellPath(`${tmpdir()}/nelcota-compose-${crypto.randomUUID()}`),
      railpackBinary: "railpack",
      network: "nelcota-test",
      buildTimeoutInSeconds: 60,
      healthCheckTimeoutInSeconds: 5,
      imagesKeptPerProject: 2,
      routingSettleInMs: 0,
      traefik: {
        httpEntrypoint: "web",
        httpsEntrypoint: "websecure",
        certResolver: "le",
        compress: false,
      },
    },
    routes: null,
  };
  const deploy = async () => {
    const { deploymentId } = requestDeployment(database, {
      projectId: project.id,
      trigger: "manual",
      actor: TEST_ACTOR,
      triggeredByUserId: null,
    });
    const status = await runDeployment(dependencies, deploymentId, new AbortController().signal);
    return { status, deployment: getDeployment(database, deploymentId) };
  };
  return { docker, deploy };
}

describe("runDeployment with Docker Compose", () => {
  test("starts every service and records the routed service's container", async () => {
    const { docker, deploy } = await setup();

    const { status, deployment } = await deploy();

    expect(status).toBe("succeeded");
    expect(docker.calls.filter((call) => call.startsWith("compose "))).toHaveLength(2);
    expect(deployment.containerName).toEndWith("-web-1");
    expect(docker.containers.size).toBe(2);
  }, 15_000);

  test("keeps the other services running across deployments", async () => {
    const { docker, deploy } = await setup();
    await deploy();
    const database = [...docker.containers.keys()].find((name) => name.endsWith("-db-1")) ?? "";

    await deploy();

    expect(docker.containers.has(database)).toBe(true);
    expect(docker.calls).not.toContain(`rm ${database}`);
  }, 20_000);

  test("fails without starting anything when the file asks for the server's network", async () => {
    const { docker, deploy } = await setup({ network_mode: "host" });

    const { status, deployment } = await deploy();

    expect(status).toBe("failed");
    expect(deployment.errorMessage).toContain("network_mode");
    expect(docker.calls.some((call) => call.startsWith("compose up"))).toBe(false);
  }, 15_000);

  test("passes the project's variables through the environment, never the generated file", async () => {
    const { docker, deploy } = await setup();

    await deploy();

    const [file] = docker.compose.upFiles;
    expect(JSON.stringify(file)).not.toContain("super-secret-value");
    expect(JSON.stringify(file)).toContain("API_TOKEN");
    expect(docker.compose.upEnvironments[0]?.["API_TOKEN"]).toBe("super-secret-value");
  }, 15_000);
});
