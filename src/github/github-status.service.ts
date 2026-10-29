import { z } from "zod";

import type { Database } from "@/db";
import type { SecretBox } from "@/secrets";

import { repositoryAccessToken } from "./github-access.service";
import { createAppJwt, GITHUB_API, type GitHubApi, githubRequest } from "./github-api";
import { type GitHubAppCredentials, readGitHubAppCredentials } from "./github-app.service";
import { GitHubApiError } from "./github.errors";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
/** GitHub cuts longer descriptions. */
const MAX_DESCRIPTION_LENGTH = 140;
const MAX_CONTEXT_LENGTH = 100;

const installationsSchema = z.array(
  z.object({
    account: z.object({ login: z.string() }).nullable(),
    permissions: z.record(z.string(), z.string()),
  }),
);

/** The status a commit shows on GitHub. */
export type CommitStatus = {
  /** Repository as `owner/name`. */
  readonly fullName: string;
  /** Full commit SHA. */
  readonly sha: string;
  readonly state: "pending" | "success" | "failure" | "error";
  readonly description: string;
  /** Page with the details, such as the deployment in the panel. */
  readonly targetUrl: string;
  /** Label of the check on GitHub; one per project, so projects of one repository coexist. */
  readonly context: string;
};

/**
 * Shows the outcome of a deployment on its commit, and on the pull requests that contain it.
 *
 * @param api - API location.
 * @param credentials - The connected app.
 * @param status - Commit, state and the texts to show.
 * @returns True when the status was published; false when the app is not installed there.
 * @throws {RangeError} When the SHA is not a full commit hash or the link is not HTTP(S).
 * @throws {GitHubApiError} When GitHub refuses, for example without the statuses permission.
 */
export async function publishCommitStatus(
  api: GitHubApi,
  credentials: GitHubAppCredentials,
  status: CommitStatus,
): Promise<boolean> {
  if (SHA_PATTERN.test(status.sha) === false) {
    throw new RangeError(`Invalid commit SHA: ${status.sha}`);
  }
  if (/^https?:\/\//.test(status.targetUrl) === false) {
    throw new RangeError(`Invalid status link: ${status.targetUrl}`);
  }
  const token = await repositoryAccessToken(api, credentials, status.fullName);
  if (token == null) {
    return false;
  }
  await githubRequest(api, {
    path: `/repos/${status.fullName}/statuses/${status.sha}`,
    method: "POST",
    bearer: token,
    body: {
      state: status.state,
      description: status.description.slice(0, MAX_DESCRIPTION_LENGTH),
      target_url: status.targetUrl,
      context: status.context.slice(0, MAX_CONTEXT_LENGTH),
    },
  });
  return true;
}

/**
 * Publishes a commit status through the connected GitHub App.
 *
 * @param database - Database.
 * @param secretBox - Encryption box.
 * @param status - Commit, state and the texts to show.
 * @returns True when published; false without an app or when it is not installed there.
 * @throws {RangeError} When the SHA or the link is invalid.
 * @throws {GitHubApiError} When GitHub refuses.
 */
export async function reportCommitStatus(
  database: Database,
  secretBox: SecretBox,
  status: CommitStatus,
): Promise<boolean> {
  const credentials = await readGitHubAppCredentials(database, secretBox);
  if (credentials == null) {
    return false;
  }
  return await publishCommitStatus(GITHUB_API, credentials, status);
}

/**
 * Finds the installations that have not granted a permission the panel needs yet. GitHub
 * asks the account owner to accept new permissions after the app asks for them.
 *
 * @param api - API location.
 * @param credentials - The connected app.
 * @param permission - Permission name, such as "statuses".
 * @returns Logins of the accounts whose installation lacks write access to it.
 * @throws {GitHubApiError} When GitHub cannot be reached or answers with an error.
 */
export async function installationsMissingPermission(
  api: GitHubApi,
  credentials: GitHubAppCredentials,
  permission: string,
): Promise<string[]> {
  const answer = await githubRequest(api, {
    path: "/app/installations",
    bearer: createAppJwt(credentials.appId, credentials.privateKey, new Date()),
  });
  const parsed = installationsSchema.safeParse(answer);
  if (parsed.success === false) {
    throw new GitHubApiError("GitHub answered the installations with an unexpected body", null);
  }
  return parsed.data
    .filter((installation) => installation.permissions[permission] !== "write")
    .flatMap((installation) => (installation.account == null ? [] : [installation.account.login]));
}

/**
 * Lists the accounts whose installation of the connected app cannot publish commit statuses.
 *
 * @param database - Database.
 * @param secretBox - Encryption box.
 * @returns Account logins; empty without an app or when every installation allows it.
 * @throws {GitHubApiError} When GitHub cannot be reached or answers with an error.
 */
export async function accountsMissingStatusPermission(
  database: Database,
  secretBox: SecretBox,
): Promise<string[]> {
  const credentials = await readGitHubAppCredentials(database, secretBox);
  if (credentials == null) {
    return [];
  }
  return await installationsMissingPermission(GITHUB_API, credentials, "statuses");
}
