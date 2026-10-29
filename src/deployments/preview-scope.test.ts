import { describe, expect, test } from "bun:test";

import { type Database, openMemoryDatabase } from "@/db";
import { closePreview, getPreview, openPreview } from "@/previews";
import { getProject } from "@/projects";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { requestDeployment } from "./deployment-request.service";
import { PreviewNotActiveError, RollbackUnavailableError } from "./deployment.errors";
import {
  completeDeployment,
  getDeployment,
  listDeployments,
  listRollbackCandidates,
  transitionDeployment,
} from "./deployment.service";

const manual = { trigger: "manual" as const, actor: TEST_ACTOR, triggeredByUserId: null };

function finish(database: Database, deploymentId: string): void {
  transitionDeployment(database, deploymentId, { to: "cloning" });
  transitionDeployment(database, deploymentId, { to: "building" });
  transitionDeployment(database, deploymentId, {
    to: "starting",
    imageTag: `nelcota/api:${deploymentId.slice(-6)}`,
    containerName: `nelcota-api-${deploymentId.slice(-6)}`,
  });
  transitionDeployment(database, deploymentId, { to: "health_checking" });
  completeDeployment(database, deploymentId);
}

function setup() {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const previewId = openPreview(database, {
    projectId: project.id,
    number: 12,
    branch: "feature/pix",
    headSha: "a".repeat(40),
  });
  const preview = () =>
    requestDeployment(database, { projectId: project.id, ...manual, previewId });
  const production = () => requestDeployment(database, { projectId: project.id, ...manual });
  return { database, project, previewId, preview, production };
}

describe("preview deployments in the queue", () => {
  test("never cancel a queued production deployment", () => {
    const { database, production, preview } = setup();
    const queued = production();

    preview();

    expect(getDeployment(database, queued.deploymentId).status).toBe("queued");
  });

  test("are never cancelled by a production deployment", () => {
    const { database, production, preview } = setup();
    const queued = preview();

    production();

    expect(getDeployment(database, queued.deploymentId).status).toBe("queued");
  });

  test("build the pull request's branch", () => {
    const { database, preview } = setup();

    expect(getDeployment(database, preview().deploymentId).branch).toBe("feature/pix");
  });

  test("throw PreviewNotActiveError once the pull request closed", () => {
    const { database, project, preview } = setup();
    closePreview(database, { projectId: project.id, number: 12 });

    expect(() => preview()).toThrow(PreviewNotActiveError);
  });
});

describe("a finished preview deployment", () => {
  test("becomes the preview's current deployment, never the project's", () => {
    const { database, project, previewId, preview } = setup();
    const { deploymentId } = preview();

    finish(database, deploymentId);

    expect(getPreview(database, previewId)?.currentDeploymentId).toBe(deploymentId);
    expect(getProject(database, project.id).currentDeploymentId).toBeNull();
  });

  test("stays out of the production history and rollback targets", () => {
    const { database, project, preview, production } = setup();
    finish(database, production().deploymentId);
    finish(database, production().deploymentId);
    finish(database, preview().deploymentId);

    expect(listDeployments(database, { projectId: project.id, limit: 10 })).toHaveLength(2);
    expect(listRollbackCandidates(database, project.id)).toHaveLength(1);
  });

  test("cannot be rolled back to from production", () => {
    const { database, project, preview } = setup();
    const { deploymentId } = preview();
    finish(database, deploymentId);

    expect(() =>
      requestDeployment(database, {
        projectId: project.id,
        ...manual,
        trigger: "rollback",
        sourceDeploymentId: deploymentId,
      }),
    ).toThrow(RollbackUnavailableError);
  });
});
