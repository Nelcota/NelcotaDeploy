import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { getDeployment, requestDeployment } from "@/deployments";
import { LABELS, volumeNameFor } from "@/docker";
import { createTestProject, FakeDocker, TEST_ACTOR } from "@/testing";
import {
  addProjectVolume,
  listProjectVolumes,
  requestVolumeDeletion,
  setVolumeAttached,
} from "@/volumes";

import {
  removeProjectResources,
  runProjectCleanup,
  runContainerAction,
  runVolumeDeletion,
} from "./container-action-runner";
import { startContainers } from "./deploy/container-start";
import { DeployState } from "./deploy/deploy-context";
import { DeploymentLogWriter } from "./deploy/deployment-log-writer";

async function startReplicas(replicas: number) {
  const database = openMemoryDatabase();
  const project = createTestProject(database, { replicas });
  const { deploymentId } = requestDeployment(database, {
    projectId: project.id,
    trigger: "manual",
    actor: TEST_ACTOR,
    triggeredByUserId: null,
  });
  const docker = new FakeDocker();
  using logs = new DeploymentLogWriter(database, deploymentId);
  await startContainers(
    { database, docker, config: { network: "nelcota" } },
    {
      deployment: getDeployment(database, deploymentId),
      project,
      logs,
      state: new DeployState(),
      assertOwnership: () => undefined,
      signal: new AbortController().signal,
    },
    {
      imageTag: "nelcota/api:abc",
      runtimeValues: {},
      runtimeConfigHash: "hash",
      buildConfigHash: null,
    },
  );
  return { database, docker, deploymentId };
}

describe("runContainerAction", () => {
  test("restarts every replica of the deployment", async () => {
    const { database, docker, deploymentId } = await startReplicas(3);

    await runContainerAction(database, docker, { deploymentId, action: "restart" });

    expect(docker.calls.filter((call) => call.startsWith("restart "))).toHaveLength(3);
  });

  test("throws when none of the deployment's replicas exists on the server", async () => {
    const { database, docker, deploymentId } = await startReplicas(2);
    docker.containers.clear();

    const error = await runContainerAction(database, docker, {
      deploymentId,
      action: "stop",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
  });
});

function setup() {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const volume = addProjectVolume(database, {
    projectId: project.id,
    input: { mountPath: "/app/data" },
    actor: TEST_ACTOR,
  });
  const change = { projectId: project.id, volumeId: volume.id, actor: TEST_ACTOR };
  setVolumeAttached(database, { ...change, attached: false });
  requestVolumeDeletion(database, change);
  const docker = new FakeDocker();
  return { database, project, volume, docker, name: volumeNameFor(volume.id) };
}

describe("runVolumeDeletion", () => {
  test("deletes the data and then the volume", async () => {
    const { database, project, volume, docker, name } = setup();
    await docker.volumes.ensure(name, project.id);

    await runVolumeDeletion(database, docker.volumes, {
      projectId: project.id,
      volumeId: volume.id,
    });

    expect(docker.volumes.owners.size).toBe(0);
    expect(listProjectVolumes(database, project.id)).toEqual([]);
  });

  test("removes a volume that was never mounted, with no data on the server", async () => {
    const { database, project, volume, docker } = setup();

    await runVolumeDeletion(database, docker.volumes, {
      projectId: project.id,
      volumeId: volume.id,
    });

    expect(listProjectVolumes(database, project.id)).toEqual([]);
  });
});

describe("runVolumeDeletion while the volume is in use", () => {
  test("keeps the volume with the reason", async () => {
    const { database, project, volume, docker, name } = setup();
    await docker.volumes.ensure(name, project.id);
    await docker.runContainer(
      {
        containerName: "nelcota-api-old",
        imageTag: "nelcota/api:old",
        network: "nelcota",
        labels: {},
        environmentKeys: [],
        volumes: [{ name, target: "/app/data" }],
      },
      {},
    );

    const error = await runVolumeDeletion(database, docker.volumes, {
      projectId: project.id,
      volumeId: volume.id,
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(Error);
    const [stored] = listProjectVolumes(database, project.id);
    expect(stored?.deletionRequestedAt).toBeNull();
    expect(stored?.deletionError).toContain("in use");
  });
});

describe("removeProjectResources", () => {
  test("keeps the project and reports a failed volume deletion for a later retry", async () => {
    const { database, project, docker, name } = setup();
    await docker.volumes.ensure(name, project.id);
    const remove = docker.volumes.remove.bind(docker.volumes);
    docker.volumes.remove = () => Promise.reject(new Error("volume is busy"));
    const failure = await runProjectCleanup(database, [{ docker, routes: null }], {
      projectId: project.id,
      storage: null,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(
      database.$client.query("SELECT id FROM projects WHERE id = ?").get(project.id),
    ).not.toBeNull();
    expect(docker.volumes.owners.has(name)).toBe(true);
    docker.volumes.remove = remove;
    await runProjectCleanup(database, [{ docker, routes: null }], {
      projectId: project.id,
      storage: null,
    });
    expect(docker.volumes.owners.has(name)).toBe(false);
    expect(
      database.$client.query("SELECT id FROM projects WHERE id = ?").get(project.id),
    ).toBeNull();
  });
  test("removes the project's volumes with its containers", async () => {
    const { project, docker, name } = setup();
    await docker.volumes.ensure(name, project.id);
    await docker.volumes.ensure("nelcota-data-other", "another-project");

    const removed = await removeProjectResources({ docker, routes: null }, project.id);

    expect(removed.volumes).toBe(1);
    expect([...docker.volumes.owners.keys()]).toEqual(["nelcota-data-other"]);
  });

  test("removes the project's database containers", async () => {
    const { project, docker } = setup();
    const run = {
      imageTag: "postgres:18.6-alpine",
      network: "nelcota",
      environmentKeys: [],
      volumes: [],
    };
    await docker.runContainer(
      {
        ...run,
        containerName: "nelcota-db-own",
        labels: { [LABELS.databaseProjectId]: project.id },
      },
      {},
    );
    await docker.runContainer(
      {
        ...run,
        containerName: "nelcota-db-other",
        labels: { [LABELS.databaseProjectId]: "another" },
      },
      {},
    );

    const removed = await removeProjectResources({ docker, routes: null }, project.id);

    expect(removed.containers).toBe(1);
    expect([...docker.containers.keys()]).toEqual(["nelcota-db-other"]);
  });
});
