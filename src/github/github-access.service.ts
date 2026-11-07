import { z } from "zod";

import type { Database } from "@/db";
import type { SecretBox } from "@/secrets";

import {
  GITHUB_API,
  type GitHubApi,
  githubApiFailure,
  githubAppAuthentication,
  githubInstallationToken,
  githubPages,
  githubRequest,
} from "./github-api";
import { type GitHubAppCredentials, readGitHubAppCredentials } from "./github-app.service";
import { GitHubApiError } from "./github.errors";

const HTTP_NOT_FOUND = 404;
const PAGE_SIZE = 100;
/** Bounds the listing: 20 installations of up to 1,000 repositories each. */
const MAX_INSTALLATIONS = 20;
const MAX_PAGES = 10;
// Dots alone would turn the name into a relative path ("../..").
const FULL_NAME_PATTERN = /^(?!\.{1,2}\/)[A-Za-z0-9_.-]+\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;

const installationSchema = z.object({ id: z.number().int().positive() });
const repositoryPageSchema = z
  .array(
    z.object({
      full_name: z.string(),
      clone_url: z.url({ protocol: /^https$/ }),
      private: z.boolean(),
      default_branch: z.string(),
    }),
  )
  .max(PAGE_SIZE);

/** A repository the app can read. */
export type GitHubRepository = {
  readonly fullName: string;
  readonly cloneUrl: string;
  readonly isPrivate: boolean;
  readonly defaultBranch: string;
};

function parseOrThrow<T>(schema: z.ZodType<T>, answer: unknown, what: string): T {
  const parsed = schema.safeParse(answer);
  if (parsed.success === false) {
    throw new GitHubApiError(`GitHub answered ${what} with an unexpected body`, null);
  }
  return parsed.data;
}

/**
 * Gets a token that can clone a repository, when the app is installed on it.
 *
 * @param api - API location.
 * @param credentials - The connected app.
 * @param fullName - Repository as `owner/name`.
 * @returns A read token valid for up to an hour, or null when the app cannot read the repository.
 * @throws {RangeError} When the name is not `owner/name`.
 * @throws {GitHubApiError} When GitHub cannot be reached or answers with an error.
 */
export async function repositoryAccessToken(
  api: GitHubApi,
  credentials: GitHubAppCredentials,
  fullName: string,
): Promise<string | null> {
  if (FULL_NAME_PATTERN.test(fullName) === false) {
    throw new RangeError(`Invalid repository name: ${fullName}`);
  }
  const { token } = await githubAppAuthentication(api, credentials)({ type: "app" });
  const answer = await githubRequest(api, {
    path: `/repos/${fullName}/installation`,
    bearer: token,
  }).catch((error: unknown) => {
    if (error instanceof GitHubApiError && error.status === HTTP_NOT_FOUND) {
      return null;
    }
    throw error;
  });
  if (answer == null) {
    return null;
  }
  const installation = parseOrThrow(installationSchema, answer, "an installation");
  return await githubInstallationToken(api, credentials, installation.id);
}

async function listInstallationRepositories(
  api: GitHubApi,
  credentials: GitHubAppCredentials,
  installationId: number,
): Promise<GitHubRepository[]> {
  const token = await githubInstallationToken(api, credentials, installationId);
  const repositories: GitHubRepository[] = [];
  let pageCount = 0;
  for await (const page of githubPages(
    api,
    `/installation/repositories?per_page=${PAGE_SIZE}`,
    token,
  )) {
    const rows = parseOrThrow(repositoryPageSchema, page.data, "a repository page");
    repositories.push(
      ...rows.map((repository) => ({
        fullName: repository.full_name,
        cloneUrl: repository.clone_url,
        isPrivate: repository.private,
        defaultBranch: repository.default_branch,
      })),
    );
    pageCount += 1;
    if (pageCount >= MAX_PAGES) {
      break;
    }
  }
  return repositories;
}

/**
 * Lists every repository the app was installed on, across accounts.
 *
 * @param api - API location.
 * @param credentials - The connected app.
 * @returns The repositories sorted by name, up to 20 installations of 1,000 repositories.
 * @throws {GitHubApiError} When GitHub cannot be reached or answers with an error.
 */
export async function listAppRepositories(
  api: GitHubApi,
  credentials: GitHubAppCredentials,
): Promise<GitHubRepository[]> {
  const { token } = await githubAppAuthentication(api, credentials)({ type: "app" });
  const answer = await githubRequest(api, {
    path: `/app/installations?per_page=${MAX_INSTALLATIONS}`,
    bearer: token,
  });
  const installations = parseOrThrow(z.array(installationSchema), answer, "the installations");
  const perInstallation = await Promise.all(
    installations.map(
      async (installation) =>
        await listInstallationRepositories(api, credentials, installation.id).catch(
          (error: unknown) => {
            if (error instanceof GitHubApiError) {
              throw error;
            }
            throw githubApiFailure(error, "repository pagination");
          },
        ),
    ),
  );
  return perInstallation
    .flat()
    .toSorted((left, right) => left.fullName.localeCompare(right.fullName));
}

/**
 * Gets a clone token for a repository from the connected GitHub App.
 *
 * @param database - Database.
 * @param secretBox - Encryption box.
 * @param fullName - Repository as `owner/name`.
 * @returns The token, or null when no app is connected or it is not installed on the repository.
 * @throws {GitHubApiError} When GitHub cannot be reached or answers with an error.
 */
export async function appCloneToken(
  database: Database,
  secretBox: SecretBox,
  fullName: string,
): Promise<string | null> {
  const credentials = await readGitHubAppCredentials(database, secretBox);
  if (credentials == null) {
    return null;
  }
  return await repositoryAccessToken(GITHUB_API, credentials, fullName);
}

/**
 * Lists the repositories the connected GitHub App can read.
 *
 * @param database - Database.
 * @param secretBox - Encryption box.
 * @returns The repositories, or null when no app is connected.
 * @throws {GitHubApiError} When GitHub cannot be reached or answers with an error.
 */
export async function listConnectedRepositories(
  database: Database,
  secretBox: SecretBox,
): Promise<GitHubRepository[] | null> {
  const credentials = await readGitHubAppCredentials(database, secretBox);
  if (credentials == null) {
    return null;
  }
  return await listAppRepositories(GITHUB_API, credentials);
}
