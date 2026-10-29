import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openMemoryDatabase, tables } from "@/db";
import { getDeployment, requestDeployment } from "@/deployments";
import { listActivePreviews } from "@/previews";
import { saveSystemSettings } from "@/settings";
import { DEFAULT_SYSTEM_SETTINGS } from "@/shared/schemas/settings.schema";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { processPullRequest } from "./pull-request-event";

const SHA = "f".repeat(40);

function pullRequestBody(
  overrides: {
    readonly action?: string;
    readonly number?: number;
    readonly headRepo?: string | null;
  } = {},
): string {
  const headRepo = overrides.headRepo === undefined ? "acme/api" : overrides.headRepo;
  return JSON.stringify({
    action: overrides.action ?? "opened",
    number: overrides.number ?? 12,
    pull_request: {
      title: "Add Pix",
      head: {
        sha: SHA,
        ref: "feature/pix",
        repo: headRepo == null ? null : { full_name: headRepo },
      },
      base: { ref: "main", repo: { full_name: "acme/api" } },
    },
    sender: { login: "ana" },
  });
}

function setup(options: { readonly previews?: boolean; readonly baseDomain?: string | null } = {}) {
  const database = openMemoryDatabase();
  saveSystemSettings(database, {
    ...DEFAULT_SYSTEM_SETTINGS,
    baseDomain: options.baseDomain === undefined ? "apps.example.com" : options.baseDomain,
  });
  const project = createTestProject(database, { previewsEnabled: options.previews ?? true });
  return { database, project };
}

describe("processPullRequest opening a preview", () => {
  test("deploys an opened pull request as a preview of the project", () => {
    const { database, project } = setup();

    const outcome = processPullRequest(database, pullRequestBody());

    expect(outcome.result.status).toBe("accepted");
    const [deploymentId = ""] =
      outcome.result.status === "accepted" ? outcome.result.deploymentIds : [];
    const deployment = getDeployment(database, deploymentId);
    const [preview] = listActivePreviews(database, project.id);
    expect(deployment.previewId).toBe(preview?.id ?? "");
    expect(deployment.branch).toBe("feature/pix");
    expect(deployment.requestedCommitSha).toBe(SHA);
  });

  test("leaves a queued production deployment alone", () => {
    const { database, project } = setup();
    const production = requestDeployment(database, {
      projectId: project.id,
      trigger: "manual",
      actor: TEST_ACTOR,
      triggeredByUserId: null,
    });

    processPullRequest(database, pullRequestBody());

    expect(getDeployment(database, production.deploymentId).status).toBe("queued");
  });
});

describe("processPullRequest refusals", () => {
  test("never deploys a pull request from a fork", () => {
    const { database, project } = setup();

    const outcome = processPullRequest(database, pullRequestBody({ headRepo: "stranger/api" }));

    expect(outcome.result).toEqual({
      status: "ignored",
      reason: "pull requests from forks never get previews",
    });
    expect(listActivePreviews(database, project.id)).toEqual([]);
  });

  test("treats a pull request from a deleted fork as a fork", () => {
    const { database } = setup();

    expect(processPullRequest(database, pullRequestBody({ headRepo: null })).result.status).toBe(
      "ignored",
    );
  });

  test("ignores projects with previews turned off", () => {
    const { database } = setup({ previews: false });

    expect(processPullRequest(database, pullRequestBody()).result.status).toBe("ignored");
  });

  test("needs a base domain for the preview's address", () => {
    const { database, project } = setup({ baseDomain: null });

    expect(processPullRequest(database, pullRequestBody()).result).toEqual({
      status: "ignored",
      reason: "previews need a base domain for their address",
    });
    expect(listActivePreviews(database, project.id)).toEqual([]);
  });

  test("ignores a payload without the required fields", () => {
    const { database } = setup();

    expect(processPullRequest(database, "{}").result.status).toBe("ignored");
  });
});

describe("processPullRequest closing a preview", () => {
  test("closes the preview and queues its removal", () => {
    const { database, project } = setup();
    processPullRequest(database, pullRequestBody());

    const outcome = processPullRequest(database, pullRequestBody({ action: "closed" }));

    expect(outcome.result.status).toBe("ignored");
    expect(listActivePreviews(database, project.id)).toEqual([]);
    const cleanups = database
      .select({ kind: tables.jobs.kind })
      .from(tables.jobs)
      .where(eq(tables.jobs.kind, "preview_cleanup"))
      .all();
    expect(cleanups).toHaveLength(1);
  });
});
