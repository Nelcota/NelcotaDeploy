import { afterAll, afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";

import { githubAppAuthentication, githubInstallationToken, githubRequest } from "./github-api";
import { GitHubApiError } from "./github.errors";

const keys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const server = Bun.serve({
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/ok") {
      return Response.json({ authorization: request.headers.get("authorization") });
    }
    return Response.json({ message: "Not Found" }, { status: 404 });
  },
});
const api = { baseUrl: server.url.origin };

afterAll(async () => {
  await server.stop(true);
});

afterEach(() => {
  setSystemTime();
});

function decodePart(part: string | undefined): unknown {
  return JSON.parse(Buffer.from(part ?? "", "base64url").toString());
}

describe("githubAppAuthentication", () => {
  test("signs the app id with RS256 using the SDK's clock-skew margin and ten-minute lifetime", async () => {
    const now = new Date("2026-10-29T12:00:00Z");
    setSystemTime(now);

    const authentication = await githubAppAuthentication(api, {
      appId: "123",
      privateKey: keys.privateKey,
    })({ type: "app" });

    const [header, payload, signature] = authentication.token.split(".");
    expect(decodePart(header)).toEqual({ alg: "RS256", typ: "JWT" });
    const issuedAt = now.getTime() / 1000 - 30;
    expect(decodePart(payload)).toEqual({ iat: issuedAt, exp: issuedAt + 600, iss: "123" });
    expect(authentication.type).toBe("app");
    expect(authentication.appId).toBe("123");
    expect(authentication.expiresAt).toBe("2026-10-29T12:09:30.000Z");
    const signed = Buffer.from(`${header}.${payload}`);
    const valid = verify(
      "sha256",
      signed,
      keys.publicKey,
      Buffer.from(signature ?? "", "base64url"),
    );
    expect(valid).toBe(true);
  });
});

describe("githubRequest", () => {
  test("sends the bearer credential and returns the JSON answer", async () => {
    const answer = await githubRequest(api, { path: "/ok", bearer: "abc" });

    expect(answer).toEqual({ authorization: "Bearer abc" });
  });

  test("throws GitHubApiError with the status of an error answer", async () => {
    const error = await githubRequest(api, { path: "/missing" }).catch(
      (requestError: unknown) => requestError,
    );

    expect(error).toBeInstanceOf(GitHubApiError);
    expect(error instanceof GitHubApiError ? error.status : null).toBe(404);
  });

  test("throws GitHubApiError when GitHub cannot be reached", async () => {
    const error = await githubRequest({ baseUrl: "http://127.0.0.1:9" }, { path: "/ok" }).catch(
      (requestError: unknown) => requestError,
    );

    expect(error).toBeInstanceOf(GitHubApiError);
  });
});

test("isolates simultaneous installation tokens across different apps and API hosts", async () => {
  const providerDelayInMs = 30;
  const first = Bun.serve({
    port: 0,
    async fetch() {
      await Bun.sleep(providerDelayInMs);
      return Response.json({ token: "first-app-token", expires_at: "2027-01-01T00:00:00Z" });
    },
  });
  await using _first = { [Symbol.asyncDispose]: async () => await first.stop(true) };
  const second = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({ token: "second-app-token", expires_at: "2027-01-01T00:00:00Z" });
    },
  });
  await using _second = { [Symbol.asyncDispose]: async () => await second.stop(true) };
  const tokens = await Promise.all([
    githubInstallationToken(
      { baseUrl: first.url.origin },
      { appId: "first", privateKey: keys.privateKey },
      99,
    ),
    githubInstallationToken(
      { baseUrl: second.url.origin },
      { appId: "second", privateKey: keys.privateKey },
      99,
    ),
  ]);
  expect(tokens).toEqual(["first-app-token", "second-app-token"]);
});
