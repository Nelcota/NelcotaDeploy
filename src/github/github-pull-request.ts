import { z } from "zod";

import { FULL_NAME_PATTERN } from "./github-access.service";
import { GITHUB_API, githubRequest, type GitHubApi } from "./github-api";
import { GitHubApiError } from "./github.errors";

const MAX_REPOSITORY_NAME_LENGTH = 200;
const MAX_BRANCH_LENGTH = 300;
const MAX_PULL_REQUEST_NUMBER = 9_999_999;
const repository = z.object({
  full_name: z.string().max(MAX_REPOSITORY_NAME_LENGTH).regex(FULL_NAME_PATTERN),
});
const branch = z.string().min(1).max(MAX_BRANCH_LENGTH);

/** Repository and revision fields common to GitHub webhook and REST pull requests. */
export const pullRequestFields = z.object({
  title: z.string(),
  head: z.object({
    sha: z.string().regex(/^[a-f0-9]{40}$/),
    ref: branch,
    repo: repository.nullable(),
  }),
  base: z.object({ ref: branch, repo: repository }),
});

const pullRequestSnapshot = pullRequestFields.extend({ state: z.enum(["open", "closed"]) });

/** Current state of a pull request as reported by GitHub. */
export type GitHubPullRequest = z.infer<typeof pullRequestSnapshot>;

/**
 * Reads the authoritative state of a pull request with the configured repository credential.
 *
 * @param target - Repository, pull request number and optional read token.
 * @param api - API location used by integration tests.
 * @returns The validated pull request state and current commit.
 * @throws {RangeError} When the repository or pull request number is invalid.
 * @throws {GitHubApiError} When GitHub fails or returns an unrelated or invalid snapshot.
 */
export async function getGitHubPullRequest(
  target: {
    readonly repositoryFullName: string;
    readonly number: number;
    readonly token: string | null;
  },
  api: GitHubApi = GITHUB_API,
): Promise<GitHubPullRequest> {
  if (
    target.repositoryFullName.length > MAX_REPOSITORY_NAME_LENGTH ||
    FULL_NAME_PATTERN.test(target.repositoryFullName) === false ||
    Number.isSafeInteger(target.number) === false ||
    target.number < 1 ||
    target.number > MAX_PULL_REQUEST_NUMBER
  ) {
    throw new RangeError("Invalid GitHub pull request target");
  }

  const response = await githubRequest(api, {
    path: `/repos/${target.repositoryFullName}/pulls/${target.number}`,
    ...(target.token == null ? {} : { bearer: target.token }),
  });
  const parsed = pullRequestSnapshot.safeParse(response);
  if (
    parsed.success === false ||
    parsed.data.base.repo.full_name.toLowerCase() !== target.repositoryFullName.toLowerCase()
  ) {
    throw new GitHubApiError("GitHub returned an invalid pull request snapshot", null);
  }

  return parsed.data;
}
