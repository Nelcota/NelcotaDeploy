import { expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { claimNextJob, completeJob, failJob } from "@/jobs";
import { closePreview, openPreview } from "@/previews";
import { requestProjectDeletion } from "@/projects";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { requeueFailedCleanups } from "./cleanup-recovery";

test("requeues a failed project cleanup exactly once until it succeeds", () => {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  requestProjectDeletion(database, project.id, TEST_ACTOR);
  const job = claimNextJob(database, "worker");
  if (job == null) {
    throw new Error("Expected a cleanup job");
  }
  failJob(database, job, { errorMessage: "offline", retryable: false });
  expect(requeueFailedCleanups(database)).toBe(1);
  expect(requeueFailedCleanups(database)).toBe(0);
  const retry = claimNextJob(database, "replacement");
  if (retry == null) {
    throw new Error("Expected a retried cleanup job");
  }
  completeJob(database, retry);
  expect(requeueFailedCleanups(database)).toBe(0);
});

test.each([false, true])("retries a closed preview but skips a reopened one: %s", (reopened) => {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const input = { projectId: project.id, number: 1, branch: "feature", headSha: "a".repeat(40) };
  openPreview(database, input);
  closePreview(database, input);
  const job = claimNextJob(database, "worker");
  if (job == null) {
    throw new Error("Expected a preview cleanup job");
  }
  failJob(database, job, { errorMessage: "SSH unavailable", retryable: false });
  if (reopened) {
    openPreview(database, input);
  }
  expect(requeueFailedCleanups(database)).toBe(reopened ? 0 : 1);
  expect(requeueFailedCleanups(database)).toBe(0);
});
