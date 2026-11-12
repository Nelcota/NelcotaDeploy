import { expect, setSystemTime, test } from "bun:test";

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

test("does not retry a failed cleanup superseded by a later close of the same preview", () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  using _clock = { [Symbol.dispose]: () => setSystemTime() };
  setSystemTime(new Date("2026-11-12T12:00:00Z"));
  const project = createTestProject(database);
  const target = { projectId: project.id, number: 1, branch: "feature", headSha: "a".repeat(40) };
  openPreview(database, target);
  closePreview(database, target);
  const first = claimNextJob(database, "worker");
  if (first == null) {
    throw new Error("Expected the first cleanup");
  }

  failJob(database, first, { errorMessage: "SSH unavailable", retryable: false });
  setSystemTime(new Date("2026-11-12T12:01:00Z"));
  openPreview(database, target);
  closePreview(database, target);
  const second = claimNextJob(database, "worker");
  if (second == null) {
    throw new Error("Expected the second cleanup");
  }

  expect(second.id).not.toBe(first.id);
  expect(completeJob(database, second)).toBe(true);
  expect(requeueFailedCleanups(database)).toBe(0);
});
