import { expect, test } from "bun:test";

import { GitHubApiError } from "../github.errors";
import { readRepositoryBranches } from "./repository-metadata";

function branchPages(input: { readonly pageCount: number; readonly invalidLastPage?: boolean }) {
  const requests: { readonly page: number; readonly authorization: string | null }[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const page = Number(url.searchParams.get("page") ?? "1");
      requests.push({ page, authorization: request.headers.get("authorization") });
      const next = new URL(url);
      next.searchParams.set("page", String(page + 1));
      const rows = Array.from({ length: 100 }, (_, index) => ({ name: `branch-${page}-${index}` }));
      return Response.json(input.invalidLastPage === true && page === input.pageCount ? {} : rows, {
        headers: page < input.pageCount ? { Link: `<${next.href}>; rel="next"` } : {},
      });
    },
  });
  return {
    api: { baseUrl: server.url.origin },
    requests,
    [Symbol.asyncDispose]: async () => await server.stop(true),
  };
}

test("uses GitHub pagination links and keeps the bearer token on each page", async () => {
  await using provider = branchPages({ pageCount: 2 });
  const result = await readRepositoryBranches(provider.api, {
    fullName: "acme/api",
    bearer: "fixture-token",
  });
  expect(result.branches).toHaveLength(200);
  expect(result.branches.at(-1)).toBe("branch-2-99");
  expect(result.branchesLimited).toBe(false);
  expect(provider.requests).toEqual([
    { page: 1, authorization: "Bearer fixture-token" },
    { page: 2, authorization: "Bearer fixture-token" },
  ]);
});

test("does not read a sixth branch page and reports bounded discovery", async () => {
  await using provider = branchPages({ pageCount: 6 });
  const result = await readRepositoryBranches(provider.api, { fullName: "acme/api" });
  expect(result.branches).toHaveLength(500);
  expect(result.branchesLimited).toBe(true);
  expect(provider.requests.map((request) => request.page)).toEqual([1, 2, 3, 4, 5]);
});

test("rejects malformed branch metadata from a subsequent SDK page", async () => {
  await using provider = branchPages({ pageCount: 2, invalidLastPage: true });
  const failure: unknown = await readRepositoryBranches(provider.api, {
    fullName: "acme/api",
  }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubApiError);
  expect(provider.requests).toHaveLength(2);
});
