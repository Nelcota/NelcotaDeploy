import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { getDeployment, requestDeployment } from "@/deployments";
import { createTestProject, FakeDocker, TEST_ACTOR } from "@/testing";
import { addProjectVolume, setVolumeAttached } from "@/volumes";

import { startContainer } from "./container-start";
import { DeployState } from "./deploy-context";
import { DeploymentLogWriter } from "./deployment-log-writer";

const RELEASE = {
  imageTag: "nelcota/api:abc",
  runtimeValues: {},
  runtimeConfigHash: "hash",
  buildConfigHash: null,
};

describe("startContainer volumes", () => {
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

    await startContainer({ database, docker, config: { network: "nelcota" } }, context, RELEASE);

    const [mounts = []] = docker.mounts.values();
    expect(mounts.map((mount) => mount.target)).toEqual(["/app/data"]);
    expect([...docker.volumes.owners.keys()]).toEqual(mounts.map((mount) => mount.name));
  });
});
