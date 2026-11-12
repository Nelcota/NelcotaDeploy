import { expect, test } from "bun:test";

import { getGitHubPullRequest } from "./github-pull-request";
import { GitHubApiError } from "./github.errors";

const SNAPSHOT = {
  state: "open" as const,
  title: "New API",
  head: { sha: "c".repeat(40), ref: "feature", repo: { full_name: "acme/api" } },
  base: { ref: "main", repo: { full_name: "acme/api" } },
};

test("loads the authoritative pull request with the repository token", async () => {
  const requests: { path: string; credential: string | null }[] = [];
  using api = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push({
        path: new URL(request.url).pathname,
        credential: request.headers.get("authorization"),
      });
      return Response.json(SNAPSHOT);
    },
  });

  const result = await getGitHubPullRequest(
    { repositoryFullName: "acme/api", number: 12, token: "test-installation-token" },
    { baseUrl: api.url.origin },
  );

  expect(result).toEqual(SNAPSHOT);
  expect(requests).toEqual([
    { path: "/repos/acme/api/pulls/12", credential: "Bearer test-installation-token" },
  ]);
});

test("rejects a snapshot belonging to a different repository", async () => {
  using api = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json(SNAPSHOT) });

  const outcome = await getGitHubPullRequest(
    { repositoryFullName: "acme/other", number: 12, token: null },
    { baseUrl: api.url.origin },
  ).catch((error: unknown) => error);

  expect(outcome).toBeInstanceOf(GitHubApiError);
});

test("rejects a malformed pull request number before making a request", async () => {
  const outcome = await getGitHubPullRequest({
    repositoryFullName: "acme/api",
    number: Number.NaN,
    token: null,
  }).catch((error: unknown) => error);

  expect(outcome).toBeInstanceOf(RangeError);
});
