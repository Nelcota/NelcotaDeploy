import { afterAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";

import { createAppJwt, githubRequest } from "./github-api";
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

function decodePart(part: string | undefined): unknown {
  return JSON.parse(Buffer.from(part ?? "", "base64url").toString());
}

describe("createAppJwt", () => {
  test("signs the app id with RS256 for 9 minutes, a minute in the past", () => {
    const now = new Date("2026-10-29T12:00:00Z");

    const jwt = createAppJwt("123", keys.privateKey, now);

    const [header, payload, signature] = jwt.split(".");
    expect(decodePart(header)).toEqual({ alg: "RS256", typ: "JWT" });
    const issuedAt = now.getTime() / 1000 - 60;
    expect(decodePart(payload)).toEqual({ iat: issuedAt, exp: issuedAt + 540, iss: "123" });
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
