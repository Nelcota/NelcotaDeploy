import { sign } from "node:crypto";

import { GitHubApiError } from "./github.errors";

const REQUEST_TIMEOUT_IN_MS = 10_000;
const API_VERSION = "2022-11-28";
const SECONDS_PER_MS = 1000;
// GitHub rejects app tokens issued in the future, so the clock is moved back a minute, and
// tokens that live longer than 10 minutes.
const CLOCK_DRIFT_IN_SECONDS = 60;
const APP_TOKEN_LIFETIME_IN_SECONDS = 540;

/** Where the GitHub REST API lives; tests point it at a local server. */
export type GitHubApi = { readonly baseUrl: string };

/** The public GitHub REST API. */
export const GITHUB_API: GitHubApi = { baseUrl: "https://api.github.com" };

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/**
 * Creates the short-lived token a GitHub App uses to call the API as itself.
 *
 * @param appId - Id of the GitHub App.
 * @param privateKeyPem - The app's private key, as GitHub generated it.
 * @param now - Current time.
 * @returns A JWT signed with RS256, valid for 9 minutes.
 */
export function createAppJwt(appId: string, privateKeyPem: string, now: Date): string {
  const issuedAt = Math.floor(now.getTime() / SECONDS_PER_MS) - CLOCK_DRIFT_IN_SECONDS;
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ iat: issuedAt, exp: issuedAt + APP_TOKEN_LIFETIME_IN_SECONDS, iss: appId }),
  );
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), privateKeyPem);
  return `${header}.${payload}.${base64Url(signature)}`;
}

/**
 * Calls the GitHub REST API.
 *
 * @param api - API location.
 * @param request - Path (starting with `/`), method, `Bearer` credential and JSON body.
 * @returns The parsed JSON answer.
 * @throws {GitHubApiError} When the request fails, times out or GitHub answers with an error.
 */
export async function githubRequest(
  api: GitHubApi,
  request: {
    readonly path: string;
    readonly method?: "GET" | "POST";
    readonly bearer?: string;
  },
): Promise<unknown> {
  const method = request.method ?? "GET";
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "nelcota-deploy",
  };
  if (request.bearer != null) {
    headers["Authorization"] = `Bearer ${request.bearer}`;
  }
  const response = await fetch(`${api.baseUrl}${request.path}`, {
    method,
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_IN_MS),
  }).catch((error: unknown) => {
    throw new GitHubApiError(`GitHub ${method} ${request.path} failed: ${String(error)}`, null);
  });
  if (response.ok === false) {
    throw new GitHubApiError(
      `GitHub ${method} ${request.path} answered ${response.status}`,
      response.status,
    );
  }
  return await response.json();
}
