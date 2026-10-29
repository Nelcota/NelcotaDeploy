import { afterAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";

import { listAppRepositories, repositoryAccessToken } from "./github-access.service";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const HOUR_IN_MS = 3_600_000;
const tokenRequests: string[] = [];

function repository(fullName: string) {
  return {
    full_name: fullName,
    clone_url: `https://github.com/${fullName}.git`,
    private: true,
    default_branch: "main",
  };
}

const REPOSITORIES_BY_TOKEN: Record<string, unknown> = {
  "Bearer token-7": { total_count: 1, repositories: [repository("acme/web")] },
  "Bearer token-8": { total_count: 1, repositories: [repository("beta/api")] },
};

// A fake GitHub API: the app is installed on acme (7) and beta (8), not on acme/missing.
const github = Bun.serve({
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    const tokenMatch = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path);
    if (tokenMatch != null) {
      tokenRequests.push(path);
      const expiresAt = new Date(Date.now() + HOUR_IN_MS).toISOString();
      return Response.json({ token: `token-${tokenMatch[1]}`, expires_at: expiresAt });
    }
    if (path === "/repos/acme/api/installation") {
      return Response.json({ id: 7 });
    }
    if (path === "/app/installations") {
      return Response.json([{ id: 7 }, { id: 8 }]);
    }
    if (path === "/installation/repositories") {
      return Response.json(REPOSITORIES_BY_TOKEN[request.headers.get("authorization") ?? ""]);
    }
    return Response.json({ message: "Not Found" }, { status: 404 });
  },
});
const api = { baseUrl: github.url.origin };

afterAll(async () => {
  await github.stop(true);
});

function credentials(appId: string) {
  return { appId, privateKey, webhookSecret: null };
}

describe("repositoryAccessToken", () => {
  test("returns a token of the installation that covers the repository", async () => {
    expect(await repositoryAccessToken(api, credentials("1"), "acme/api")).toBe("token-7");
  });

  test("reuses the token while it is still valid", async () => {
    const app = credentials("2");
    await repositoryAccessToken(api, app, "acme/api");
    const before = tokenRequests.length;

    await repositoryAccessToken(api, app, "acme/api");

    expect(tokenRequests.length).toBe(before);
  });

  test("returns null when the app is not installed on the repository", async () => {
    expect(await repositoryAccessToken(api, credentials("3"), "acme/missing")).toBeNull();
  });

  test.each([["acme/../x/y"], ["../.."], ["acme/.."], ["acme"]])(
    "throws RangeError for the repository name %p",
    async (fullName) => {
      const error = await repositoryAccessToken(api, credentials("4"), fullName).catch(
        (failure: unknown) => failure,
      );

      expect(error).toBeInstanceOf(RangeError);
    },
  );
});

describe("listAppRepositories", () => {
  test("lists the repositories of every installation, sorted by name", async () => {
    const repositories = await listAppRepositories(api, credentials("5"));

    expect(repositories.map((item) => item.fullName)).toEqual(["acme/web", "beta/api"]);
    expect(repositories[0]).toEqual({
      fullName: "acme/web",
      cloneUrl: "https://github.com/acme/web.git",
      isPrivate: true,
      defaultBranch: "main",
    });
  });
});
