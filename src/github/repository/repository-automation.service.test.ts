import { expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { createTestSecretBox } from "@/testing";

import { GitHubApiError } from "../github.errors";
import {
  readRepositoryTaskScripts,
  readRepositoryVolumeHints,
  readRepositoryHealthCheck,
} from "./repository-automation.service";

const request = {
  repositoryUrl: "https://github.com/acme/api",
  branch: "main",
  buildContext: ".",
  dockerfilePath: "Dockerfile",
};
const manifest = JSON.stringify({
  scripts: {
    "db:migrate": "SECRET=never-return-this bun migrate.ts",
    "cache:clear": "bun cache.ts",
  },
});

function fixture(
  files: readonly { readonly path: string; readonly text: string; readonly symlink?: boolean }[],
) {
  const blobs = files.map((file) => ({
    ...file,
    sha: new Bun.CryptoHasher("sha1").update(file.text).digest("hex"),
  }));
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(incoming) {
      const path = new URL(incoming.url).pathname;
      requests.push(path);
      if (path.includes("/git/trees/")) {
        return Response.json({
          truncated: false,
          tree: blobs.map((file) => ({
            path: file.path,
            sha: file.sha,
            type: "blob",
            mode: file.symlink === true ? "120000" : "100644",
            size: Buffer.byteLength(file.text),
          })),
        });
      }
      const file = blobs.find((candidate) => path.endsWith(candidate.sha));
      if (file == null) {
        return Response.json({}, { status: 404 });
      }
      return Response.json({
        sha: file.sha,
        size: Buffer.byteLength(file.text),
        encoding: "base64",
        content: Buffer.from(file.text).toString("base64"),
      });
    },
  });
  return {
    api: { baseUrl: server.url.origin },
    requests,
    [Symbol.asyncDispose]: async () => await server.stop(true),
  };
}

test("reads the health check of the exact selected file without probing its URL", async () => {
  await using github = fixture([
    { path: "Dockerfile", text: "FROM alpine\nHEALTHCHECK CMD curl http://localhost/default" },
    {
      path: "apps/Dockerfile",
      text: "FROM alpine\nHEALTHCHECK CMD curl -f http://localhost:3000/ready",
    },
  ]);
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const result = await readRepositoryHealthCheck(
    { database, secretBox: await createTestSecretBox(), api: github.api },
    { ...request, dockerfilePath: "apps/Dockerfile" },
  );
  expect(result.path).toBe("/ready");
  expect(result.dockerfilePath).toBe("apps/Dockerfile");
  expect(github.requests).toHaveLength(2);
});

test("returns no health path for a missing or unsafe Dockerfile", async () => {
  await using github = fixture([
    {
      path: "Dockerfile",
      text: "FROM alpine\nHEALTHCHECK CMD curl http://localhost/private",
      symlink: true,
    },
  ]);
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const result = await readRepositoryHealthCheck(
    { database, secretBox: await createTestSecretBox(), api: github.api },
    request,
  );
  expect(result.path).toBeNull();
  expect(result.source).toBeNull();
});

test("requires manual health configuration when Dockerfile hints are incomplete", async () => {
  await using github = fixture([
    {
      path: "Dockerfile",
      text: "FROM alpine AS base\nHEALTHCHECK CMD curl http://localhost/original\nONBUILD HEALTHCHECK NONE\nFROM base",
    },
  ]);
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const result = await readRepositoryHealthCheck(
    { database, secretBox: await createTestSecretBox(), api: github.api },
    request,
  );
  expect(result.path).toBeNull();
  expect(result.source?.path).toBe("Dockerfile");
});

test("rejects invalid health-check build paths before reading the repository", async () => {
  await using github = fixture([]);
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const error: unknown = await readRepositoryHealthCheck(
    { database, secretBox: await createTestSecretBox(), api: github.api },
    { ...request, dockerfilePath: "../Dockerfile" },
  ).catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(RangeError);
  expect(github.requests).toHaveLength(0);
});

test("discovers script names and Bun without returning script bodies or executing commands", async () => {
  await using github = fixture([
    { path: "package.json", text: manifest },
    { path: "Dockerfile", text: "FROM oven/bun:1.4\nVOLUME /data" },
  ]);
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const result = await readRepositoryTaskScripts(
    { database, secretBox: await createTestSecretBox(), api: github.api },
    request,
  );
  expect(result.source?.path).toBe("package.json");
  expect(result.bunDetected).toBe(true);
  expect(result.scripts).toEqual([
    { name: "db:migrate", commandLine: "bun run db:migrate" },
    { name: "cache:clear", commandLine: "bun run cache:clear" },
  ]);
  expect(JSON.stringify(result)).not.toContain("never-return-this");
  expect(github.requests.filter((path) => path.includes("/git/blobs/"))).toHaveLength(2);
});

test("prefers the build context's package and supports selecting another discovered manifest", async () => {
  await using github = fixture([
    { path: "package.json", text: manifest },
    { path: "apps/api/package.json", text: '{"scripts":{"clean":"bun clean.ts"}}' },
  ]);
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const dependencies = { database, secretBox: await createTestSecretBox(), api: github.api };
  expect(
    (
      await readRepositoryTaskScripts(dependencies, { ...request, buildContext: "apps/api" })
    ).scripts.at(0)?.name,
  ).toBe("clean");
  expect(
    (
      await readRepositoryTaskScripts(dependencies, {
        ...request,
        buildContext: "apps/api",
        packagePath: "package.json",
      })
    ).source?.path,
  ).toBe("package.json");
});

test("requires a choice among unrelated manifests and never follows symlinks", async () => {
  await using github = fixture([
    { path: "package.json", text: manifest, symlink: true },
    { path: "api/package.json", text: manifest },
    { path: "web/package.json", text: manifest },
  ]);
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const result = await readRepositoryTaskScripts(
    { database, secretBox: await createTestSecretBox(), api: github.api },
    request,
  );
  expect(result.source).toBeNull();
  expect(result.paths).toEqual(["api/package.json", "web/package.json"]);
  expect(github.requests).toHaveLength(1);
});

test.each([".env", "../package.json", "/package.json"])(
  "rejects unsafe manifest selection %s before reading",
  async (packagePath) => {
    await using github = fixture([]);
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const error: unknown = await readRepositoryTaskScripts(
      { database, secretBox: await createTestSecretBox(), api: github.api },
      { ...request, packagePath },
    ).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(RangeError);
    expect(github.requests).toHaveLength(0);
  },
);

test.each(["not-json", '{"scripts":{"bad":123}}'])(
  "rejects an invalid manifest %s",
  async (text) => {
    await using github = fixture([{ path: "package.json", text }]);
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const error: unknown = await readRepositoryTaskScripts(
      { database, secretBox: await createTestSecretBox(), api: github.api },
      request,
    ).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(GitHubApiError);
  },
);

test("bounds script suggestions and excludes unsafe names and empty bodies", async () => {
  const scripts = Object.fromEntries([
    ...Array.from({ length: 101 }, (_, index): [string, string] => [
      `script-${index}`,
      "bun safe.ts",
    ]),
    ["--unsafe", "bun bad.ts"],
    ["empty", " "],
  ]);
  await using github = fixture([{ path: "package.json", text: JSON.stringify({ scripts }) }]);
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const result = await readRepositoryTaskScripts(
    { database, secretBox: await createTestSecretBox(), api: github.api },
    request,
  );
  expect(result.scripts).toHaveLength(100);
  expect(result.limited).toBe(true);
  expect(result.scripts.some((script) => script.name === "--unsafe")).toBe(false);
});

test("uses the exact selected Dockerfile rather than a different stage or file", async () => {
  await using github = fixture([
    { path: "Dockerfile", text: "FROM alpine\nVOLUME /wrong" },
    {
      path: "containers/custom.build",
      text: "FROM alpine AS build\nVOLUME /builder\nFROM scratch\nVOLUME /data",
    },
  ]);
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const result = await readRepositoryVolumeHints(
    { database, secretBox: await createTestSecretBox(), api: github.api },
    { ...request, dockerfilePath: "containers/custom.build" },
  );
  expect(result.source?.path).toBe("containers/custom.build");
  expect(result.paths).toEqual(["/data"]);
});

test("does not suggest mounts from a symlink Dockerfile", async () => {
  await using github = fixture([
    { path: "Dockerfile", text: "FROM alpine\nVOLUME /data", symlink: true },
  ]);
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const result = await readRepositoryVolumeHints(
    { database, secretBox: await createTestSecretBox(), api: github.api },
    request,
  );
  expect(result.source).toBeNull();
  expect(result.paths).toEqual([]);
  expect(github.requests).toHaveLength(1);
});
