import { afterAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";

import { installationsMissingPermission, publishCommitStatus } from "./github-status.service";
import { GitHubApiError } from "./github.errors";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const SHA = "a".repeat(40);
const HOUR_IN_MS = 3_600_000;
const statuses: unknown[] = [];

// A fake GitHub API: the app is installed on acme/api, and on acme/locked without the statuses
// permission.
const github = Bun.serve({
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/repos/acme/api/installation" || path === "/repos/acme/locked/installation") {
      return Response.json({ id: 7 });
    }
    if (path === "/app/installations/7/access_tokens") {
      return Response.json({
        token: "token-7",
        expires_at: new Date(Date.now() + HOUR_IN_MS).toISOString(),
      });
    }
    if (path === `/repos/acme/locked/statuses/${SHA}`) {
      return Response.json({ message: "Resource not accessible by integration" }, { status: 403 });
    }
    if (path === `/repos/acme/api/statuses/${SHA}` && request.method === "POST") {
      statuses.push(await request.json());
      return Response.json({}, { status: 201 });
    }
    if (path === "/app/installations") {
      return Response.json([
        { account: { login: "acme" }, permissions: { contents: "read", statuses: "write" } },
        { account: { login: "beta" }, permissions: { contents: "read" } },
      ]);
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

const STATUS = {
  fullName: "acme/api",
  sha: SHA,
  state: "success" as const,
  description: "Deploy concluído",
  targetUrl: "https://deploy.example.com/projects/p/deployments/d",
  context: "Nelcota Deploy (api)",
};

describe("publishCommitStatus", () => {
  test("publishes the state, texts and link on the commit", async () => {
    const published = await publishCommitStatus(api, credentials("11"), STATUS);

    expect(published).toBe(true);
    expect(statuses.at(-1)).toEqual({
      state: "success",
      description: "Deploy concluído",
      target_url: STATUS.targetUrl,
      context: "Nelcota Deploy (api)",
    });
  });

  test("does nothing for a repository the app is not installed on", async () => {
    expect(
      await publishCommitStatus(api, credentials("12"), { ...STATUS, fullName: "acme/other" }),
    ).toBe(false);
  });

  test("throws GitHubApiError when the installation lacks the permission", async () => {
    const error = await publishCommitStatus(api, credentials("13"), {
      ...STATUS,
      fullName: "acme/locked",
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(GitHubApiError);
  });

  test.each([["abc"], ["A".repeat(40)]])("throws RangeError for the SHA %p", async (sha) => {
    const error = await publishCommitStatus(api, credentials("14"), { ...STATUS, sha }).catch(
      (failure: unknown) => failure,
    );

    expect(error).toBeInstanceOf(RangeError);
  });

  test("throws RangeError for a link that is not HTTP", async () => {
    const error = await publishCommitStatus(api, credentials("15"), {
      ...STATUS,
      targetUrl: "javascript:alert(1)",
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(RangeError);
  });
});

describe("installationsMissingPermission", () => {
  test("lists the accounts that have not granted the permission", async () => {
    expect(await installationsMissingPermission(api, credentials("16"), "statuses")).toEqual([
      "beta",
    ]);
  });
});
