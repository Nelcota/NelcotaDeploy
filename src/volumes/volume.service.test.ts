import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { claimNextJob } from "@/jobs";
import { createTestProject, TEST_ACTOR } from "@/testing";

import {
  ProjectHasVolumesError,
  VolumeAttachedError,
  VolumeBeingDeletedError,
  VolumeLimitError,
  VolumeNotFoundError,
  VolumePathOverlapError,
} from "./volume.errors";
import {
  addProjectVolume,
  assertProjectHasNoVolumes,
  failVolumeDeletion,
  finishVolumeDeletion,
  listMountedVolumes,
  listProjectVolumes,
  requestVolumeDeletion,
  setVolumeAttached,
} from "./volume.service";

function setup() {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const add = (mountPath: string) =>
    addProjectVolume(database, { projectId: project.id, input: { mountPath }, actor: TEST_ACTOR });
  const change = (volumeId: string) => ({ projectId: project.id, volumeId, actor: TEST_ACTOR });
  return { database, project, add, change };
}

describe("addProjectVolume", () => {
  test("adds an attached volume that the next deployment mounts", () => {
    const { database, project, add } = setup();

    const volume = add("/app/data");

    expect(volume.attached).toBe(true);
    expect(listMountedVolumes(database, project.id)).toEqual([
      { id: volume.id, mountPath: "/app/data" },
    ]);
  });

  test("throws VolumePathOverlapError for a path inside another volume", () => {
    const { add } = setup();
    add("/app/data");

    expect(() => add("/app/data/uploads")).toThrow(VolumePathOverlapError);
  });

  test("throws VolumePathOverlapError for a path that overlaps a detached volume", () => {
    const { database, add, change } = setup();
    const detached = add("/app/data");
    setVolumeAttached(database, { ...change(detached.id), attached: false });

    expect(() => add("/app/data/uploads")).toThrow(VolumePathOverlapError);
  });

  test("throws VolumeLimitError past 10 volumes", () => {
    const { add } = setup();
    for (let index = 0; index < 10; index += 1) {
      add(`/data${index}`);
    }

    expect(() => add("/data10")).toThrow(VolumeLimitError);
  });
});

describe("setVolumeAttached", () => {
  test("stops mounting a detached volume and keeps it listed", () => {
    const { database, project, add, change } = setup();
    const volume = add("/app/data");

    setVolumeAttached(database, { ...change(volume.id), attached: false });

    expect(listMountedVolumes(database, project.id)).toEqual([]);
    expect(listProjectVolumes(database, project.id)).toHaveLength(1);
  });

  test("throws VolumeBeingDeletedError when reattaching a volume whose data is going", () => {
    const { database, add, change } = setup();
    const volume = add("/app/data");
    setVolumeAttached(database, { ...change(volume.id), attached: false });
    requestVolumeDeletion(database, change(volume.id));

    expect(() => setVolumeAttached(database, { ...change(volume.id), attached: true })).toThrow(
      VolumeBeingDeletedError,
    );
  });

  test("throws VolumeNotFoundError for a volume of another project", () => {
    const { database, add } = setup();
    const volume = add("/app/data");
    const other = createTestProject(database, { slug: "other", name: "Other" });

    expect(() =>
      setVolumeAttached(database, {
        projectId: other.id,
        volumeId: volume.id,
        actor: TEST_ACTOR,
        attached: false,
      }),
    ).toThrow(VolumeNotFoundError);
  });
});

describe("requestVolumeDeletion", () => {
  test("queues the deletion of a detached volume", () => {
    const { database, project, add, change } = setup();
    const volume = add("/app/data");
    setVolumeAttached(database, { ...change(volume.id), attached: false });

    requestVolumeDeletion(database, change(volume.id));

    const job = claimNextJob(database, "worker");
    expect(job?.kind).toBe("volume_delete");
    expect(job?.payload).toEqual({ volumeId: volume.id });
    expect(listProjectVolumes(database, project.id)[0]?.deletionRequestedAt).not.toBeNull();
  });

  test("throws VolumeAttachedError for a volume still mounted", () => {
    const { database, add, change } = setup();
    const volume = add("/app/data");

    expect(() => requestVolumeDeletion(database, change(volume.id))).toThrow(VolumeAttachedError);
  });

  test("throws VolumeBeingDeletedError when a deletion is already pending", () => {
    const { database, add, change } = setup();
    const volume = add("/app/data");
    setVolumeAttached(database, { ...change(volume.id), attached: false });
    requestVolumeDeletion(database, change(volume.id));

    expect(() => requestVolumeDeletion(database, change(volume.id))).toThrow(
      VolumeBeingDeletedError,
    );
  });
});

describe("volume deletion outcome", () => {
  test("removes the volume once its data is gone", () => {
    const { database, project, add, change } = setup();
    const volume = add("/app/data");
    setVolumeAttached(database, { ...change(volume.id), attached: false });
    requestVolumeDeletion(database, change(volume.id));

    finishVolumeDeletion(database, volume.id);

    expect(listProjectVolumes(database, project.id)).toEqual([]);
  });

  test("keeps the volume with the reason when the deletion failed", () => {
    const { database, project, add, change } = setup();
    const volume = add("/app/data");
    setVolumeAttached(database, { ...change(volume.id), attached: false });
    requestVolumeDeletion(database, change(volume.id));

    failVolumeDeletion(database, volume.id, "volume is in use");

    const [stored] = listProjectVolumes(database, project.id);
    expect(stored?.deletionRequestedAt).toBeNull();
    expect(stored?.deletionError).toBe("volume is in use");
  });
});

describe("assertProjectHasNoVolumes", () => {
  test("throws ProjectHasVolumesError while a detached volume still holds data", () => {
    const { database, project, add, change } = setup();
    const volume = add("/app/data");
    setVolumeAttached(database, { ...change(volume.id), attached: false });

    expect(() => assertProjectHasNoVolumes(database, project.id)).toThrow(ProjectHasVolumesError);
  });

  test("lets a project without volumes move", () => {
    const { database, project } = setup();

    expect(() => assertProjectHasNoVolumes(database, project.id)).not.toThrow();
  });
});
