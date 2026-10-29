import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { volumeNameFor } from "@/docker";
import { createTestProject, FakeDocker, TEST_ACTOR } from "@/testing";
import {
  addProjectVolume,
  listProjectVolumes,
  requestVolumeDeletion,
  setVolumeAttached,
} from "@/volumes";

import { removeProjectResources, runVolumeDeletion } from "./container-action-runner";

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
  test("removes the project's volumes with its containers", async () => {
    const { project, docker, name } = setup();
    await docker.volumes.ensure(name, project.id);
    await docker.volumes.ensure("nelcota-data-other", "another-project");

    const removed = await removeProjectResources({ docker, routes: null }, project.id);

    expect(removed.volumes).toBe(1);
    expect([...docker.volumes.owners.keys()]).toEqual(["nelcota-data-other"]);
  });
});
