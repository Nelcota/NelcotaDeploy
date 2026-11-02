import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { projectInputSchema } from "@/shared/schemas/project.schema";
import { createTestProject, TEST_ACTOR } from "@/testing";
import { addProjectVolume, setVolumeAttached } from "@/volumes";

import { ReplicasNeedNoVolumesError } from "./project.errors";
import { getProject, updateProject } from "./project.service";

function setReplicas(
  database: ReturnType<typeof openMemoryDatabase>,
  project: ReturnType<typeof createTestProject>,
  replicas: number,
) {
  const input = projectInputSchema.parse({ ...project, healthCheckPath: "", replicas });
  return updateProject(database, {
    projectId: project.id,
    input,
    editor: { actor: TEST_ACTOR, isAdmin: true },
  });
}

describe("updateProject replicas", () => {
  test("saves the number of replicas", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);

    setReplicas(database, project, 3);

    expect(getProject(database, project.id).replicas).toBe(3);
  });

  test("throws ReplicasNeedNoVolumesError when the project mounts a volume", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    addProjectVolume(database, {
      projectId: project.id,
      input: { mountPath: "/app/data" },
      actor: TEST_ACTOR,
    });

    expect(() => setReplicas(database, project, 2)).toThrow(ReplicasNeedNoVolumesError);
  });

  test("allows replicas when the project's volumes are detached", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const volume = addProjectVolume(database, {
      projectId: project.id,
      input: { mountPath: "/app/data" },
      actor: TEST_ACTOR,
    });
    setVolumeAttached(database, {
      projectId: project.id,
      volumeId: volume.id,
      actor: TEST_ACTOR,
      attached: false,
    });

    setReplicas(database, project, 2);

    expect(getProject(database, project.id).replicas).toBe(2);
  });
});

describe("projectInputSchema replicas", () => {
  test("defaults to one replica", () => {
    const project = createTestProject(openMemoryDatabase());
    const { replicas: _replicas, ...withoutReplicas } = project;

    const input = projectInputSchema.parse({ ...withoutReplicas, healthCheckPath: "" });

    expect(input.replicas).toBe(1);
  });

  test.each([0, 11, 1.5, Number.NaN])("rejects %p replicas", (replicas) => {
    const project = createTestProject(openMemoryDatabase());

    const result = projectInputSchema.safeParse({ ...project, healthCheckPath: "", replicas });

    expect(result.success).toBe(false);
  });
});
