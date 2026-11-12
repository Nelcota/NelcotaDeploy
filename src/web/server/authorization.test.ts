import { describe, expect, test } from "bun:test";

import { ForbiddenError, TwoFactorRequiredError, UnauthenticatedError } from "@/auth";
import { DeploymentNotFoundError } from "@/deployments";
import { ProjectNotFoundError } from "@/projects";

import { accessErrorResponse } from "./authorization";

describe("accessErrorResponse", () => {
  test.each([
    { error: new UnauthenticatedError(), status: 401, body: "Unauthorized" },
    { error: new ForbiddenError("project:read"), status: 403, body: "Forbidden" },
    { error: new TwoFactorRequiredError(), status: 403, body: "Forbidden" },
    { error: new ProjectNotFoundError("project-id"), status: 404, body: "Not found" },
    { error: new DeploymentNotFoundError("deployment-id"), status: 404, body: "Not found" },
  ])("returns HTTP $status for an expected access denial", async ({ error, status, body }) => {
    const response = accessErrorResponse(error);

    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe(body);
  });

  test("propagates an unexpected database failure", () => {
    const error = new Error("Database is unavailable");

    expect(() => accessErrorResponse(error)).toThrow(error);
  });
});
