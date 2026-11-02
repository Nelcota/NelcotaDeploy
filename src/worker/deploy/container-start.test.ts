import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { getDeployment, requestDeployment } from "@/deployments";
import { createTestProject, FakeDocker, TEST_ACTOR } from "@/testing";
import { addProjectVolume, setVolumeAttached } from "@/volumes";

import { replicaCountOf, startContainers } from "./container-start";
import { DeployState } from "./deploy-context";
import { DeploymentLogWriter } from "./deployment-log-writer";

const RELEASE = {
  imageTag: "nelcota/api:abc",
  runtimeValues: {},
  runtimeConfigHash: "hash",
  buildConfigHash: null,
};

describe("startContainers volumes", () => {
  test("creates and mounts the attached volumes, never the detached ones", async () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const { deploymentId } = requestDeployment(database, {
      projectId: project.id,
      trigger: "manual",
      actor: TEST_ACTOR,
      triggeredByUserId: null,
    });
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

    await startContainers({ database, docker, config: { network: "nelcota" } }, context, RELEASE);

    const [mounts = []] = docker.mounts.values();
    expect(mounts.map((mount) => mount.target)).toEqual(["/app/data"]);
    expect([...docker.volumes.owners.keys()]).toEqual(mounts.map((mount) => mount.name));
  });
});

function startSetup(replicas: number) {
  const database = openMemoryDatabase();
  const project = createTestProject(database, { replicas });
  const { deploymentId } = requestDeployment(database, {
    projectId: project.id,
    trigger: "manual",
    actor: TEST_ACTOR,
    triggeredByUserId: null,
  });
  return { database, project, deployment: getDeployment(database, deploymentId) };
}

describe("startContainers replicas", () => {
  test("starts one container per replica, the deployment's own name first", async () => {
    const { database, project, deployment } = startSetup(3);
    const docker = new FakeDocker();
    using logs = new DeploymentLogWriter(database, deployment.id);
    const state = new DeployState();

    const names = await startContainers(
      { database, docker, config: { network: "nelcota" } },
      { deployment, project, logs, state },
      RELEASE,
    );

    expect(names).toHaveLength(3);
    expect(names[1]).toBe(`${names[0]}-2`);
    expect(names[2]).toBe(`${names[0]}-3`);
    expect(state.containerNames.toSorted()).toEqual(names.toSorted());
    expect(getDeployment(database, deployment.id).containerName).toBe(names[0] ?? "");
  });
});

describe("replicaCountOf", () => {
  test("runs the project's replicas in production", () => {
    const { project, deployment } = startSetup(4);

    expect(replicaCountOf({ deployment, project })).toBe(4);
  });

  test("runs a single container for a pull request preview", () => {
    const { project, deployment } = startSetup(4);
    const preview = { ...deployment, previewId: "preview-1" };

    expect(replicaCountOf({ deployment: preview, project })).toBe(1);
  });
});
