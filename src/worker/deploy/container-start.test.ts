import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { getDeployment, requestDeployment } from "@/deployments";
import { addDomain } from "@/domains";
import { RouteFiles } from "@/routing";
import { createTestProject, FakeDocker, TEST_ACTOR } from "@/testing";
import { addProjectVolume, setVolumeAttached } from "@/volumes";

import { routeTrafficTo, startContainer } from "./container-start";
import { DeployState } from "./deploy-context";
import { DeploymentLogWriter } from "./deployment-log-writer";

const CONTAINER = "nelcota-api-0c1d2e3f4a5b";
const TRAEFIK = {
  httpEntrypoint: "web",
  httpsEntrypoint: "websecure",
  certResolver: "le",
  compress: false,
};

function setup(options: { readonly withDomain: boolean }) {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  if (options.withDomain) {
    addDomain(database, {
      projectId: project.id,
      input: { hostname: "api.example.com", httpsEnabled: true },
      actor: TEST_ACTOR,
    });
  }
  const { deploymentId } = requestDeployment(database, {
    projectId: project.id,
    trigger: "manual",
    actor: TEST_ACTOR,
    triggeredByUserId: null,
  });
  // Records the commands instead of touching a server.
  const commands: (readonly string[])[] = [];
  const routes = new RouteFiles(async (command) => {
    commands.push(command);
    return await Promise.resolve({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      aborted: false,
    });
  }, "/routes");
  const dependencies = { database, routes, config: { routingSettleInMs: 0, traefik: TRAEFIK } };
  return { database, deploymentId, project, commands, dependencies };
}

describe("routeTrafficTo", () => {
  test("points the project's routes at the new container alone", async () => {
    const { database, deploymentId, project, commands, dependencies } = setup({ withDomain: true });
    using logs = new DeploymentLogWriter(database, deploymentId);

    await routeTrafficTo(dependencies, { project, logs }, CONTAINER);

    // The file content is the last argument of the write.
    const written: unknown = JSON.parse(commands.at(0)?.at(-1) ?? "null");
    expect(written).toMatchObject({
      http: {
        services: {
          "nelcota-api": { loadBalancer: { servers: [{ url: `http://${CONTAINER}:3000` }] } },
        },
      },
    });
  });

  test("removes the routes of a project without domains", async () => {
    const { database, deploymentId, project, commands, dependencies } = setup({
      withDomain: false,
    });
    using logs = new DeploymentLogWriter(database, deploymentId);

    await routeTrafficTo(dependencies, { project, logs }, CONTAINER);

    expect(commands).toEqual([["rm", "-f", "--", `/routes/${project.id}.yml`]]);
  });
});

const RELEASE = {
  imageTag: "nelcota/api:abc",
  runtimeValues: {},
  runtimeConfigHash: "hash",
  buildConfigHash: null,
};

describe("startContainer volumes", () => {
  test("creates and mounts the attached volumes, never the detached ones", async () => {
    const { database, deploymentId, project } = setup({ withDomain: false });
    const add = (mountPath: string) =>
      addProjectVolume(database, {
        projectId: project.id,
        input: { mountPath },
        actor: TEST_ACTOR,
      });
    add("/app/data");
    const detached = add("/app/cache");
    setVolumeAttached(database, {
      projectId: project.id,
      volumeId: detached.id,
      actor: TEST_ACTOR,
      attached: false,
    });
    const docker = new FakeDocker();
    using logs = new DeploymentLogWriter(database, deploymentId);
    const context = {
      deployment: getDeployment(database, deploymentId),
      project,
      logs,
      state: new DeployState(),
    };

    await startContainer({ database, docker, config: { network: "nelcota" } }, context, RELEASE);

    const [mounts = []] = docker.mounts.values();
    expect(mounts.map((mount) => mount.target)).toEqual(["/app/data"]);
    expect([...docker.volumes.owners.keys()]).toEqual(mounts.map((mount) => mount.name));
  });
});
