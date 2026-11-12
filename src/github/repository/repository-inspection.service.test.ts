import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";

import { openMemoryDatabase } from "@/db";
import { createTestSecretBox, TEST_ACTOR } from "@/testing";

import { saveGitHubApp } from "../github-app.service";
import { GitHubApiError } from "../github.errors";
import { getRepositoryAccess, inspectRepository } from "./repository-inspection.service";

type Fixture = {
  readonly appInstalled?: boolean;
  readonly branches?: readonly unknown[];
  readonly tree?: readonly unknown[];
  readonly truncated?: boolean;
  readonly status?: number;
  readonly details?: unknown;
};

function githubFixture(fixture: Fixture = {}) {
  const requests: { path: string; authorization: string | null }[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push({ path: url.pathname, authorization: request.headers.get("authorization") });
      if (fixture.status != null) {
        return Response.json({}, { status: fixture.status });
      }
      if (url.pathname.endsWith("/installation")) {
        return fixture.appInstalled === true
          ? Response.json({ id: 7 })
          : Response.json({}, { status: 404 });
      }
      if (url.pathname === "/app/installations/7/access_tokens") {
        return Response.json({
          token: "fixture-app-credential",
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        });
      }
      if (url.pathname.endsWith("/branches")) {
        return Response.json(fixture.branches ?? [{ name: "master" }, { name: "feature/api" }]);
      }
      if (url.pathname.includes("/git/trees/")) {
        return Response.json({
          tree: fixture.tree ?? [
            { path: "apps/api/Dockerfile", type: "blob", mode: "100644" },
            { path: "apps/api", type: "tree", mode: "040000" },
          ],
          truncated: fixture.truncated ?? false,
        });
      }
      return Response.json(fixture.details ?? { default_branch: "master", private: false });
    },
  });
  return {
    api: { baseUrl: server.url.origin },
    requests,
    [Symbol.asyncDispose]: async () => await server.stop(true),
  };
}

describe("inspectRepository", () => {
  test("discovers the real default branch, nested Dockerfiles and directories from a pasted URL", async () => {
    await using github = githubFixture();
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const box = await createTestSecretBox();

    const result = await inspectRepository(
      { database, secretBox: box, api: github.api },
      { repositoryUrl: "https://github.com/acme/api" },
    );

    expect(result).toMatchObject({
      defaultBranch: "master",
      branch: "master",
      access: "public",
      dockerfiles: ["apps/api/Dockerfile"],
      directories: [".", "apps/api"],
    });
    expect(github.requests.some((request) => request.path.endsWith("/git/trees/master"))).toBe(
      true,
    );
  });

  test("uses an explicitly chosen branch and keeps a saved token server-side", async () => {
    await using github = githubFixture();
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const box = await createTestSecretBox();

    const result = await inspectRepository(
      { database, secretBox: box, api: github.api },
      {
        repositoryUrl: "https://github.com/acme/api",
        branch: "feature/api",
        token: "fixture-credential",
      },
    );

    expect(result.branch).toBe("feature/api");
    expect(result.access).toBe("token");
    expect(
      github.requests.every((request) => request.authorization === "Bearer fixture-credential"),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain("fixture-credential");
    expect(github.requests.some((request) => request.path.endsWith("/feature%2Fapi"))).toBe(true);
  });

  test("excludes traversal paths, symlinks and unsupported branches from suggestions", async () => {
    await using github = githubFixture({
      branches: [{ name: "main" }, { name: "../escape" }],
      tree: [
        { path: "Dockerfile", type: "blob", mode: "120000" },
        { path: "../Dockerfile", type: "blob", mode: "100644" },
        { path: "/Dockerfile", type: "blob", mode: "100644" },
        { path: "Dockerfile.prod", type: "blob", mode: "100644" },
      ],
    });
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const box = await createTestSecretBox();

    const result = await inspectRepository(
      { database, secretBox: box, api: github.api },
      { repositoryUrl: "https://github.com/acme/api" },
    );

    expect(result.dockerfiles).toEqual(["Dockerfile.prod"]);
    expect(result.branches).toEqual(["main"]);
  });

  test("reports incomplete trees without claiming discovery was exhaustive", async () => {
    await using github = githubFixture({ truncated: true });
    const database = openMemoryDatabase();
    using _connection = database.$client;

    const result = await inspectRepository(
      { database, secretBox: await createTestSecretBox(), api: github.api },
      { repositoryUrl: "https://github.com/acme/api" },
    );

    expect(result.pathsLimited).toBe(true);
  });

  test.each([404, 403, 500])(
    "propagates GitHub HTTP %s instead of silently hiding detection",
    async (status) => {
      await using github = githubFixture({ status });
      const database = openMemoryDatabase();
      using _connection = database.$client;

      const error: unknown = await inspectRepository(
        { database, secretBox: await createTestSecretBox(), api: github.api },
        { repositoryUrl: "https://github.com/acme/api" },
      ).catch((failure: unknown) => failure);

      expect(error).toBeInstanceOf(GitHubApiError);
    },
  );

  test.each([
    { repositoryUrl: "https://evil.example/acme/api" },
    { repositoryUrl: "" },
    { repositoryUrl: "https://github.com/acme/api", branch: "../invalid" },
  ])("rejects unsafe inspection input %p without making a request", async (request) => {
    await using github = githubFixture();
    const database = openMemoryDatabase();
    using _connection = database.$client;

    const error: unknown = await inspectRepository(
      { database, secretBox: await createTestSecretBox(), api: github.api },
      request,
    ).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(RangeError);
    expect(github.requests).toHaveLength(0);
  });

  test("rejects malformed GitHub metadata", async () => {
    await using github = githubFixture({
      details: { default_branch: "../escape", private: false },
    });
    const database = openMemoryDatabase();
    using _connection = database.$client;

    const error: unknown = await inspectRepository(
      { database, secretBox: await createTestSecretBox(), api: github.api },
      { repositoryUrl: "https://github.com/acme/api" },
    ).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(GitHubApiError);
  });
});

test("uses the GitHub App for a private repository without requiring a manual token", async () => {
  await using github = githubFixture({
    appInstalled: true,
    details: { default_branch: "master", private: true },
  });
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const secretBox = await createTestSecretBox();
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  await saveGitHubApp(database, secretBox, {
    actor: TEST_ACTOR,
    app: {
      id: 42,
      slug: "fixture-app",
      name: "Fixture",
      html_url: "https://github.com/apps/fixture-app",
      owner: { login: "acme" },
      pem: keys.privateKey,
      webhook_secret: "fixture-webhook",
      client_id: "fixture-client",
      client_secret: "fixture-client-secret",
    },
  });

  const result = await inspectRepository(
    { database, secretBox, api: github.api },
    { repositoryUrl: "https://github.com/acme/api" },
  );

  expect(result.access).toBe("github-app");
  expect(result.isPrivate).toBe(true);
  expect(JSON.stringify(result)).not.toContain("fixture-app-credential");
  expect(
    github.requests.some((request) => request.authorization === "Bearer fixture-app-credential"),
  ).toBe(true);
});

test("withholds the GitHub App credential when allowGitHubApp is false", async () => {
  await using github = githubFixture({
    appInstalled: true,
    details: { default_branch: "master", private: false },
  });
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const secretBox = await createTestSecretBox();
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  await saveGitHubApp(database, secretBox, {
    actor: TEST_ACTOR,
    app: {
      id: 42,
      slug: "fixture-app",
      name: "Fixture",
      html_url: "https://github.com/apps/fixture-app",
      owner: { login: "acme" },
      pem: keys.privateKey,
      webhook_secret: "fixture-webhook",
      client_id: "fixture-client",
      client_secret: "fixture-client-secret",
    },
  });

  const result = await inspectRepository(
    { database, secretBox, api: github.api },
    { repositoryUrl: "https://github.com/acme/api", allowGitHubApp: false },
  );

  expect(result.access).toBe("public");
  expect(github.requests.every((request) => request.authorization == null)).toBe(true);
});

test("getRepositoryAccess verifies public access without listing branches or files", async () => {
  await using github = githubFixture();
  const database = openMemoryDatabase();
  using _connection = database.$client;

  const result = await getRepositoryAccess(
    { database, secretBox: await createTestSecretBox(), api: github.api },
    { repositoryUrl: "https://github.com/acme/api" },
  );

  expect(result.access).toBe("public");
  expect(github.requests).toHaveLength(1);
});
