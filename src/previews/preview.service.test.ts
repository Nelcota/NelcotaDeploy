import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { claimNextJob } from "@/jobs";
import { createTestProject } from "@/testing";

import { PreviewLimitError } from "./preview.errors";
import { closePreview, getPreview, listActivePreviews, openPreview } from "./preview.service";

const SHA = "c".repeat(40);

function setup() {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const open = (number: number, headSha = SHA) =>
    openPreview(database, { projectId: project.id, number, branch: `feature-${number}`, headSha });
  return { database, project, open };
}

describe("openPreview", () => {
  test("creates an active preview for a new pull request", () => {
    const { database, open } = setup();

    const previewId = open(12);

    expect(getPreview(database, previewId)).toMatchObject({
      pullRequestNumber: 12,
      branch: "feature-12",
      status: "active",
      currentDeploymentId: null,
    });
  });

  test("moves an existing preview to the latest commit", () => {
    const { database, open } = setup();
    const previewId = open(12);

    const again = open(12, "d".repeat(40));

    expect(again).toBe(previewId);
    expect(getPreview(database, previewId)?.headSha).toBe("d".repeat(40));
  });

  test("throws PreviewLimitError for a sixth active preview", () => {
    const { open } = setup();
    for (let number = 1; number <= 5; number += 1) {
      open(number);
    }

    expect(() => open(6)).toThrow(PreviewLimitError);
  });

  test("lets an active preview keep updating at the limit", () => {
    const { open } = setup();
    for (let number = 1; number <= 5; number += 1) {
      open(number);
    }

    expect(() => open(5, "e".repeat(40))).not.toThrow();
  });
});

describe("closePreview", () => {
  test("closes the preview and queues its cleanup", () => {
    const { database, project, open } = setup();
    const previewId = open(12);

    const closed = closePreview(database, { projectId: project.id, number: 12 });

    expect(closed).toBe(previewId);
    expect(listActivePreviews(database, project.id)).toEqual([]);
    expect(claimNextJob(database, "worker")?.payload).toEqual({ previewId });
  });

  test("does nothing for a pull request without an active preview", () => {
    const { database, project } = setup();

    expect(closePreview(database, { projectId: project.id, number: 99 })).toBeNull();
  });

  test("reopens a closed preview when the pull request reopens", () => {
    const { database, project, open } = setup();
    const previewId = open(12);
    closePreview(database, { projectId: project.id, number: 12 });

    open(12);

    expect(getPreview(database, previewId)?.status).toBe("active");
  });
});
