import { expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { createTestSecretBox } from "@/testing";

import { GitHubApiError } from "../github.errors";
import { readRepositoryEnvironmentExample } from "./repository-environment.service";

const SHA = "a".repeat(40);
const request = {
  repositoryUrl: "https://github.com/acme/api",
  branch: "main",
  buildContext: ".",
  dockerfilePath: "Dockerfile",
};

function templateApi(
  options: {
    readonly content?: string;
    readonly files?: readonly string[];
    readonly symlink?: boolean;
    readonly encoding?: string;
  } = {},
) {
  const content =
    options.content ??
    "NODE_ENV=production\nAUTH_SECRET=do-not-expose-example\nENDPOINT=https://user:secret@example.com\n";
  const calls: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(incoming) {
      const path = new URL(incoming.url).pathname;
      calls.push(path);
      if (path.includes("/git/trees/")) {
        return Response.json({
          truncated: false,
          tree: (options.files ?? [".env.example"]).map((file) => ({
            path: file,
            sha: SHA,
            size: Buffer.byteLength(content),
            type: "blob",
            mode: options.symlink === true ? "120000" : "100644",
          })),
        });
      }
      return Response.json({
        sha: SHA,
        size: Buffer.byteLength(content),
        encoding: options.encoding ?? "base64",
        content: Buffer.from(content).toString("base64"),
      });
    },
  });
  return {
    api: { baseUrl: server.url.origin },
    calls,
    [Symbol.asyncDispose]: async () => await server.stop(true),
  };
}

test("discovers and parses defaults without returning example credentials or evaluating content", async () => {
  await using github = templateApi();
  const database = openMemoryDatabase();
  using _connection = database.$client;

  const result = await readRepositoryEnvironmentExample(
    { database, secretBox: await createTestSecretBox(), api: github.api },
    request,
  );

  expect(result.source?.path).toBe(".env.example");
  expect(result.entries).toEqual([
    { key: "NODE_ENV", kind: "plain", value: "production" },
    { key: "AUTH_SECRET", kind: "secret", value: "" },
    { key: "ENDPOINT", kind: "secret", value: "" },
  ]);
  expect(JSON.stringify(result)).not.toContain("do-not-expose-example");
  expect(github.calls.at(-1)).toEndWith(`/git/blobs/${SHA}`);
});

test("prefers the build context example in a monorepo", async () => {
  await using github = templateApi({ files: [".env.example", "apps/api/.env.example"] });
  const database = openMemoryDatabase();
  using _connection = database.$client;

  const result = await readRepositoryEnvironmentExample(
    { database, secretBox: await createTestSecretBox(), api: github.api },
    { ...request, buildContext: "apps/api" },
  );

  expect(result.source?.path).toBe("apps/api/.env.example");
});

test("reports rejected lines without exposing their content and retains valid variables", async () => {
  await using github = templateApi({
    content: "NODE_ENV=production\nNELCOTA_ENCRYPTION_KEY=hidden\nmalformed-private-value",
  });
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const result = await readRepositoryEnvironmentExample(
    { database, secretBox: await createTestSecretBox(), api: github.api },
    request,
  );
  expect(result.entries).toEqual([{ key: "NODE_ENV", kind: "plain", value: "production" }]);
  expect(result.problems).toEqual([{ line: 2 }, { line: 3 }]);
  expect(JSON.stringify(result)).not.toContain("hidden");
  expect(JSON.stringify(result)).not.toContain("malformed-private-value");
});

test("requires a choice when multiple unrelated examples exist", async () => {
  await using github = templateApi({ files: ["api/.env.example", "web/.env.example"] });
  const database = openMemoryDatabase();
  using _connection = database.$client;

  const result = await readRepositoryEnvironmentExample(
    { database, secretBox: await createTestSecretBox(), api: github.api },
    request,
  );

  expect(result.source).toBeNull();
  expect(result.paths).toHaveLength(2);
});

test("does not follow a symlink named .env.example", async () => {
  await using github = templateApi({ symlink: true });
  const database = openMemoryDatabase();
  using _connection = database.$client;

  const result = await readRepositoryEnvironmentExample(
    { database, secretBox: await createTestSecretBox(), api: github.api },
    request,
  );

  expect(result.source).toBeNull();
  expect(github.calls).toHaveLength(1);
});

test.each([".env", "../.env.example", "/.env.example"])(
  "rejects a non-example or unsafe path %p",
  async (path) => {
    await using github = templateApi();
    const database = openMemoryDatabase();
    using _connection = database.$client;

    const error: unknown = await readRepositoryEnvironmentExample(
      { database, secretBox: await createTestSecretBox(), api: github.api },
      { ...request, path },
    ).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(RangeError);
    expect(github.calls).toHaveLength(0);
  },
);

test.each([
  { label: "unsupported encoding", options: { encoding: "none" } },
  { label: "oversized blob", options: { content: "x".repeat(70_000) } },
  {
    label: "too many variables",
    options: { content: Array.from({ length: 101 }, (_, index) => `VALUE_${index}=1`).join("\n") },
  },
])("rejects $label", async ({ options }) => {
  await using github = templateApi(options);
  const database = openMemoryDatabase();
  using _connection = database.$client;

  const error: unknown = await readRepositoryEnvironmentExample(
    { database, secretBox: await createTestSecretBox(), api: github.api },
    request,
  ).catch((failure: unknown) => failure);

  expect(error).toBeInstanceOf(GitHubApiError);
});
