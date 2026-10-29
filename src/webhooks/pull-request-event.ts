import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { type Database, tables } from "@/db";
import { requestDeployment } from "@/deployments";
import { createLogger } from "@/logging";
import { closePreview, openPreview, PreviewLimitError } from "@/previews";
import { getSystemSettings } from "@/settings";

import {
  commitSubject,
  ignored,
  INVALID_JSON,
  parseJsonBody,
  type ProcessedEvent,
} from "./webhook-event";

const MAX_REF_LENGTH = 300;
const MAX_GITHUB_NAME_LENGTH = 200;
const MAX_PULL_REQUEST_NUMBER = 9_999_999;
const DEPLOYING_ACTIONS = new Set(["opened", "reopened", "synchronize"]);
const logger = createLogger("github-webhook");

const repositorySchema = z.object({ full_name: z.string().max(MAX_GITHUB_NAME_LENGTH) });
const pullRequestPayloadSchema = z.object({
  action: z.string().max(MAX_GITHUB_NAME_LENGTH),
  number: z.number().int().min(1).max(MAX_PULL_REQUEST_NUMBER),
  pull_request: z.object({
    title: z.string(),
    head: z.object({
      sha: z.string().regex(/^[a-f0-9]{40}$/),
      ref: z.string().min(1).max(MAX_REF_LENGTH),
      // GitHub sends null when the fork the pull request came from was deleted.
      repo: repositorySchema.nullable(),
    }),
    base: z.object({ ref: z.string().min(1).max(MAX_REF_LENGTH), repo: repositorySchema }),
  }),
  sender: z.object({ login: z.string().max(MAX_GITHUB_NAME_LENGTH) }).optional(),
});

type PullRequestPayload = z.infer<typeof pullRequestPayloadSchema>;

/** Approved projects with previews on that follow the repository and branch the pull request targets. */
function findPreviewProjects(database: Database, payload: PullRequestPayload): string[] {
  const projects = database
    .select({ id: tables.projects.id, approved: tables.projects.deploymentsApproved })
    .from(tables.projects)
    .where(
      and(
        eq(
          tables.projects.repositoryFullName,
          payload.pull_request.base.repo.full_name.toLowerCase(),
        ),
        eq(tables.projects.branch, payload.pull_request.base.ref),
        eq(tables.projects.previewsEnabled, true),
        isNull(tables.projects.deletionRequestedAt),
      ),
    )
    .all();
  return projects.filter((project) => project.approved).map((project) => project.id);
}

/** Opens or updates a project's preview and queues its deployment; null when it is full. */
function deployPreview(
  database: Database,
  projectId: string,
  payload: PullRequestPayload,
): string | null {
  const { number, pull_request: pullRequest } = payload;
  try {
    const previewId = openPreview(database, {
      projectId,
      number,
      branch: pullRequest.head.ref,
      headSha: pullRequest.head.sha,
    });
    return requestDeployment(database, {
      projectId,
      trigger: "webhook",
      actor: { type: "webhook", label: `github:${payload.sender?.login ?? "unknown"}` },
      triggeredByUserId: null,
      commitSha: pullRequest.head.sha,
      commitMessage: commitSubject(`#${number} ${pullRequest.title}`),
      previewId,
    }).deploymentId;
  } catch (error) {
    if (error instanceof PreviewLimitError === false) {
      throw error;
    }
    logger.warn({ projectId, number }, "preview limit reached; pull request not deployed");
    return null;
  }
}

/** Deploys the previews of an opened or updated pull request. */
function deployPreviews(
  database: Database,
  projectIds: readonly string[],
  event: { readonly payload: PullRequestPayload; readonly details: Partial<ProcessedEvent> },
): ProcessedEvent {
  const { payload, details } = event;
  if (DEPLOYING_ACTIONS.has(payload.action) === false) {
    return ignored(`pull request ${payload.action} is not handled`, details);
  }
  if (getSystemSettings(database).baseDomain == null) {
    return ignored("previews need a base domain for their address", details);
  }
  const deploymentIds = projectIds.flatMap((projectId) => {
    const deploymentId = deployPreview(database, projectId, payload);
    return deploymentId == null ? [] : [deploymentId];
  });
  if (deploymentIds.length === 0) {
    return ignored("every project already runs its maximum of previews", details);
  }
  return {
    result: { status: "accepted", deploymentIds },
    repositoryFullName: details.repositoryFullName ?? null,
    ref: details.ref ?? null,
    commitSha: details.commitSha ?? null,
  };
}

function parsePullRequest(rawBody: string): PullRequestPayload | null {
  const json = parseJsonBody(rawBody);
  if (json === INVALID_JSON) {
    return null;
  }
  const parsed = pullRequestPayloadSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * Handles a `pull_request` delivery: deploys a preview when a pull request opens or gets new
 * commits, and removes it when the pull request closes.
 *
 * @remarks
 * Only pull requests from the project's own repository get a preview: a fork's code would run
 * on the server with the project's variables. Previews also need a base domain for their
 * address, and an approved project with previews turned on.
 *
 * @param database - Database.
 * @param rawBody - Verified delivery body.
 * @returns What happened, for the delivery log.
 */
export function processPullRequest(database: Database, rawBody: string): ProcessedEvent {
  const payload = parsePullRequest(rawBody);
  if (payload == null) {
    return ignored("pull request payload is missing required fields");
  }
  const { head, base } = payload.pull_request;
  const details = {
    repositoryFullName: base.repo.full_name.toLowerCase(),
    ref: head.ref,
    commitSha: head.sha,
  };
  if (head.repo?.full_name.toLowerCase() !== details.repositoryFullName) {
    return ignored("pull requests from forks never get previews", details);
  }
  const projectIds = findPreviewProjects(database, payload);
  if (projectIds.length === 0) {
    return ignored("no approved project with previews for this repository and branch", details);
  }
  if (payload.action === "closed") {
    for (const projectId of projectIds) {
      closePreview(database, { projectId, number: payload.number });
    }
    return ignored("pull request closed; its previews are being removed", details);
  }
  return deployPreviews(database, projectIds, { payload, details });
}
