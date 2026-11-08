import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { z } from "zod";

import { GitHubApiError } from "./github.errors";

const REQUEST_TIMEOUT_IN_MS = 10_000;
const API_VERSION = "2022-11-28";
const MAX_CACHED_APPS = 50;

/** Where the GitHub REST API lives; tests point it at a local server. */
export type GitHubApi = { readonly baseUrl: string };

/** The public GitHub REST API. */
export const GITHUB_API: GitHubApi = { baseUrl: "https://api.github.com" };

function createClient(api: GitHubApi) {
  return new Octokit({
    baseUrl: api.baseUrl,
    userAgent: "nelcota-deploy",
    request: { timeout: REQUEST_TIMEOUT_IN_MS },
  });
}

type AppAuthentication = ReturnType<typeof createAppAuth>;
const appAuthentications = new Map<string, AppAuthentication>();
const installationRequests = new Map<number, Promise<string>>();
const installationAuthenticationSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.iso.datetime(),
});

/** Reuses Octokit's token cache, isolating API hosts, apps and rotated private keys. */
export function githubAppAuthentication(
  api: GitHubApi,
  credentials: { readonly appId: string; readonly privateKey: string },
): AppAuthentication {
  const key = new Bun.CryptoHasher("sha256")
    .update(JSON.stringify([api.baseUrl, credentials.appId, credentials.privateKey]))
    .digest("hex");
  const cached = appAuthentications.get(key);
  if (cached != null) {
    return cached;
  }
  const authentication = createAppAuth({
    appId: credentials.appId,
    privateKey: credentials.privateKey,
    request: createClient(api).request.defaults({
      headers: { "X-GitHub-Api-Version": API_VERSION },
    }),
  });
  const oldest = appAuthentications.keys().next();
  if (appAuthentications.size >= MAX_CACHED_APPS && oldest.done === false) {
    appAuthentications.delete(oldest.value);
  }
  appAuthentications.set(key, authentication);
  return authentication;
}

/**
 * Prevents Octokit's process-wide in-flight deduplication from mixing credentials between apps.
 * Completed tokens remain cached by the SDK separately for each app and API host.
 */
export async function githubInstallationToken(
  api: GitHubApi,
  credentials: { readonly appId: string; readonly privateKey: string },
  installationId: number,
): Promise<string> {
  if (Number.isSafeInteger(installationId) === false || installationId < 1) {
    throw new RangeError(`Invalid GitHub installation id: ${installationId}`);
  }
  const previous = installationRequests.get(installationId);
  // The previous caller observes its failure; a failed attempt must not block the next app.
  const ready =
    previous?.then(
      () => undefined,
      () => undefined,
    ) ?? Promise.resolve();
  const pending = ready.then(async () => {
    const answer = await githubAppAuthentication(
      api,
      credentials,
    )({ type: "installation", installationId }).catch((error: unknown) => {
      throw githubApiFailure(error, "installation authentication");
    });
    const parsed = installationAuthenticationSchema.safeParse(answer);
    if (parsed.success === false) {
      throw new GitHubApiError("GitHub returned an invalid installation token", null);
    }
    return parsed.data.token;
  });
  installationRequests.set(installationId, pending);
  using _request = {
    [Symbol.dispose]: () => {
      if (installationRequests.get(installationId) === pending) {
        installationRequests.delete(installationId);
      }
    },
  };
  return await pending;
}

/** Converts SDK failures without leaking response bodies or credentials into logs. */
export function githubApiFailure(error: unknown, operation: string): GitHubApiError {
  const status =
    error instanceof Error && "status" in error && typeof error.status === "number"
      ? error.status
      : null;
  return new GitHubApiError(`GitHub ${operation} failed`, status);
}

/**
 * Calls the GitHub REST API.
 *
 * @param api - API location.
 * @param request - Path (starting with `/`), method, `Bearer` credential and JSON `body`.
 * @returns The parsed JSON answer.
 * @throws {GitHubApiError} When the request fails, times out or GitHub answers with an error.
 */
export async function githubRequest(
  api: GitHubApi,
  request: {
    readonly path: string;
    readonly method?: "GET" | "POST";
    readonly bearer?: string;
    readonly body?: Readonly<Record<string, unknown>>;
  },
): Promise<unknown> {
  const method = request.method ?? "GET";
  const response = await createClient(api)
    .request({
      method,
      url: request.path,
      headers: {
        "X-GitHub-Api-Version": API_VERSION,
        ...(request.bearer == null ? {} : { authorization: `Bearer ${request.bearer}` }),
      },
      ...(request.body == null ? {} : { data: request.body }),
    })
    .catch((error: unknown) => {
      throw githubApiFailure(error, `${method} ${request.path}`);
    });
  return response.data;
}

/**
 * Iterates SDK-managed pages while leaving validation and safety limits to the caller.
 * @yields A page returned by the GitHub API.
 */
export async function* githubPages(api: GitHubApi, path: string, bearer?: string) {
  try {
    yield* createClient(api).paginate.iterator(`GET ${path}`, {
      headers: {
        "X-GitHub-Api-Version": API_VERSION,
        ...(bearer == null ? {} : { authorization: `Bearer ${bearer}` }),
      },
    });
  } catch (error) {
    throw githubApiFailure(error, "pagination");
  }
}
