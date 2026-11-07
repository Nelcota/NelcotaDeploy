import { expect, test } from "bun:test";

import { ProjectMoveInProgressError, ProjectMoveReviewChangedError } from "@/servers";

import { toPublicError } from "./public-error";

test("explains a stale server move without exposing internal identity", () => {
  const message = toPublicError(new ProjectMoveReviewChangedError("private-project"))?.message;

  expect(message).toContain("O projeto mudou durante a revisão");
  expect(message).not.toContain("private-project");
});

test("explains that a move must wait for an active deployment", () => {
  expect(toPublicError(new ProjectMoveInProgressError("private-project"))?.message).toContain(
    "Aguarde o término",
  );
});
