import { z } from "zod";

import type { Database } from "@/db";
import type { SecretBox } from "@/secrets";

import { createAppJwt, GITHUB_API, type GitHubApi, githubRequest } from "./github-api";
import { type GitHubAppCredentials, readGitHubAppCredentials } from "./github-app.service";
import { GitHubApiError } from "./github.errors";

const HTTP_NOT_FOUND = 404;
const PAGE_SIZE = 100;
/** Bounds the listing: 20 installations of up to 1,000 repositories each. */
const MAX_INSTALLATIONS = 20;
const MAX_PAGES = 10;
const MAX_CACHED_TOKENS = 50;
/** Installation tokens last an hour; one is renewed when less than this remains. */
const TOKEN_RENEWAL_MARGIN_IN_MS = 300_000; // 5 minutes
// Dots alone would turn the name into a relative path ("../..").
const FULL_NAME_PATTERN = /^(?!\.{1,2}\/)[A-Za-z0-9_.-]+\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;

const installationSchema = z.object({ id: z.number().int().positive() });
const accessTokenSchema = z.object({ token: z.string().min(1), expires_at: z.string() });
const repositoryPageSchema = z.object({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(
    z.object({
      full_name: z.string(),
      clone_url: z.url({ protocol: /^https$/ }),
      private: z.boolean(),
      default_branch: z.string(),
    }),
  ),
});

/** A repository the app can read. */
export type GitHubRepository = {
  readonly fullName: string;
  readonly cloneUrl: string;
  readonly isPrivate: boolean;
  readonly defaultBranch: string;
};

const tokenCache = new Map<string, { readonly token: string; readonly expiresAtInMs: number }>();

function parseOrThrow<T>(schema: z.ZodType<T>, answer: unknown, what: string): T {
  const parsed = schema.safeParse(answer);
  if (parsed.success === false) {
    throw new GitHubApiError(`GitHub answered ${what} with an unexpected body`, null);
  }
  return parsed.data;
}

function rememberToken(key: string, token: string, expiresAtInMs: number): void {
  // Maps keep insertion order, so the first key is the oldest token.
  const oldest = tokenCache.keys().next();
  if (tokenCache.size >= MAX_CACHED_TOKENS && oldest.done === false) {
    tokenCache.delete(oldest.value);
  }
  tokenCache.set(key, { token, expiresAtInMs });
}

async function installationToken(
  api: GitHubApi,
  credentials: GitHubAppCredentials,
  installationId: number,
): Promise<string> {
  const key = `${api.baseUrl}|${credentials.appId}|${installationId}`;
  const cached = tokenCache.get(key);
  if (cached != null && cached.expiresAtInMs - Date.now() > TOKEN_RENEWAL_MARGIN_IN_MS) {
    return cached.token;
  }
  const answer = await githubRequest(api, {
    path: `/app/installations/${installationId}/access_tokens`,
    method: "POST",
    bearer: createAppJwt(credentials.appId, credentials.privateKey, new Date()),
  });
  const { token, expires_at: expiresAt } = parseOrThrow(accessTokenSchema, answer, "a token");
  const expiresAtInMs = Date.parse(expiresAt);
  if (Number.isFinite(expiresAtInMs)) {
    rememberToken(key, token, expiresAtInMs);
  }
  return token;
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
  const answer = await githubRequest(api, {
    path: `/repos/${fullName}/installation`,
    bearer: createAppJwt(credentials.appId, credentials.privateKey, new Date()),
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
  return await installationToken(api, credentials, installation.id);
}

async function fetchRepositoryPage(api: GitHubApi, token: string, page: number) {
  const answer = await githubRequest(api, {
    path: `/installation/repositories?per_page=${PAGE_SIZE}&page=${page}`,
    bearer: token,
  });
  return parseOrThrow(repositoryPageSchema, answer, "a repository page");
}

async function listInstallationRepositories(
  api: GitHubApi,
  credentials: GitHubAppCredentials,
  installationId: number,
): Promise<GitHubRepository[]> {
  const token = await installationToken(api, credentials, installationId);
  // The first page tells how many there are; the rest are fetched together.
  const first = await fetchRepositoryPage(api, token, 1);
  const pageCount = Math.min(Math.ceil(first.total_count / PAGE_SIZE), MAX_PAGES);
  const remainingPages = Array.from(
    { length: Math.max(pageCount - 1, 0) },
    (_, index) => index + 2,
  );
  const rest = await Promise.all(
    remainingPages.map(async (page) => await fetchRepositoryPage(api, token, page)),
  );
  return [first, ...rest]
    .flatMap((page) => page.repositories)
    .map((repository) => ({
      fullName: repository.full_name,
      cloneUrl: repository.clone_url,
      isPrivate: repository.private,
      defaultBranch: repository.default_branch,
    }));
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
  const answer = await githubRequest(api, {
    path: `/app/installations?per_page=${MAX_INSTALLATIONS}`,
    bearer: createAppJwt(credentials.appId, credentials.privateKey, new Date()),
  });
  const installations = parseOrThrow(z.array(installationSchema), answer, "the installations");
  const perInstallation = await Promise.all(
    installations.map(
      async (installation) => await listInstallationRepositories(api, credentials, installation.id),
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
