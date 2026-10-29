import { afterAll, describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { createTestSecretBox, TEST_ACTOR } from "@/testing";

import {
  convertManifestCode,
  getGitHubApp,
  readGitHubAppCredentials,
  removeGitHubApp,
  saveGitHubApp,
} from "./github-app.service";
import { readGitHubLoginCredentials } from "./github-login.service";
import { GitHubApiError } from "./github.errors";

const CONVERSION = {
  id: 42,
  slug: "nelcota-deploy",
  name: "Nelcota deploy.example.com",
  html_url: "https://github.com/apps/nelcota-deploy",
  owner: { login: "acme" },
  pem: "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\n",
  webhook_secret: "hook-secret",
  client_id: "Iv1.abc",
  client_secret: "client-secret",
};
const server = Bun.serve({
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path === "/app-manifests/good/conversions") {
      return Response.json(CONVERSION, { status: 201 });
    }
    if (path === "/app-manifests/odd/conversions") {
      return Response.json({ id: "not-a-number" }, { status: 201 });
    }
    return Response.json({ message: "Not Found" }, { status: 404 });
  },
});
const api = { baseUrl: server.url.origin };

afterAll(async () => {
  await server.stop(true);
});

describe("convertManifestCode", () => {
  test("returns the app GitHub created", async () => {
    expect(await convertManifestCode(api, "good")).toEqual(CONVERSION);
  });

  test.each([["odd"], ["expired"], ["../x"], [""]])(
    "throws GitHubApiError for the code %p",
    async (code) => {
      const error = await convertManifestCode(api, code).catch((failure: unknown) => failure);

      expect(error).toBeInstanceOf(GitHubApiError);
    },
  );
});

describe("saveGitHubApp", () => {
  test("stores the credentials encrypted and reads them back", async () => {
    const database = openMemoryDatabase();
    const box = await createTestSecretBox();

    const summary = await saveGitHubApp(database, box, { app: CONVERSION, actor: TEST_ACTOR });

    expect(summary.installUrl).toBe("https://github.com/apps/nelcota-deploy/installations/new");
    expect(summary.loginReady).toBe(true);
    expect(getGitHubApp(database)).toEqual(summary);
    expect(await readGitHubAppCredentials(database, box)).toEqual({
      appId: "42",
      privateKey: CONVERSION.pem,
      webhookSecret: "hook-secret",
    });
  });

  test("replaces the app connected before", async () => {
    const database = openMemoryDatabase();
    const box = await createTestSecretBox();
    await saveGitHubApp(database, box, { app: CONVERSION, actor: TEST_ACTOR });

    await saveGitHubApp(database, box, { app: { ...CONVERSION, id: 43 }, actor: TEST_ACTOR });

    expect(getGitHubApp(database)?.id).toBe("43");
  });
});

describe("readGitHubLoginCredentials", () => {
  test("decrypts the OAuth client stored with the app", async () => {
    const database = openMemoryDatabase();
    const box = await createTestSecretBox();
    await saveGitHubApp(database, box, { app: CONVERSION, actor: TEST_ACTOR });

    expect(await readGitHubLoginCredentials(database, box)).toEqual({
      clientId: "Iv1.abc",
      clientSecret: "client-secret",
    });
  });

  test("returns null without a connected app", async () => {
    expect(
      await readGitHubLoginCredentials(openMemoryDatabase(), await createTestSecretBox()),
    ).toBeNull();
  });
});

describe("removeGitHubApp", () => {
  test("forgets the app and its credentials", async () => {
    const database = openMemoryDatabase();
    const box = await createTestSecretBox();
    await saveGitHubApp(database, box, { app: CONVERSION, actor: TEST_ACTOR });

    removeGitHubApp(database, TEST_ACTOR);

    expect(getGitHubApp(database)).toBeNull();
    expect(await readGitHubAppCredentials(database, box)).toBeNull();
  });
});
