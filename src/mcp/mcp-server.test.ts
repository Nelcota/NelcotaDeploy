import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApiToken } from "@/auth";
import { type Database, migrateDatabase, openDatabase } from "@/db";
import { createTestProject, TEST_ACTOR } from "@/testing";

const MAIN = join(import.meta.dir, "main.ts");

type JsonRpcResponse = {
  id: number;
  result?: Record<string, unknown>;
  error?: { message: string };
};

/** Talks JSON-RPC to the MCP server over stdio, exactly like an MCP client does. */
class StdioClient implements AsyncDisposable {
  readonly #process: Bun.Subprocess<"pipe", "pipe", "pipe">;
  readonly #pending = new Map<number, (response: JsonRpcResponse) => void>();
  #nextId = 1;

  constructor(environment: Record<string, string>) {
    this.#process = Bun.spawn(["bun", MAIN], {
      env: { PATH: process.env["PATH"] ?? "", ...environment },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    void this.#read();
  }

  async #read(): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of this.#process.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines.filter((candidate) => candidate.trim() !== "")) {
        const message = JSON.parse(line) as JsonRpcResponse;
        this.#pending.get(message.id)?.(message);
      }
    }
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<JsonRpcResponse> {
    const id = this.#nextId++;
    const { promise, resolve } = Promise.withResolvers<JsonRpcResponse>();
    this.#pending.set(id, resolve);
    void this.#process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return await promise;
  }

  notify(method: string): void {
    void this.#process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }

  async callTool(name: string, args: Record<string, unknown>) {
    const response = await this.request("tools/call", { name, arguments: args });
    const result = response.result as { isError?: boolean; content: { text: string }[] };
    return { isError: result.isError === true, text: result.content[0]?.text ?? "" };
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#process.kill();
    await this.#process.exited;
  }
}

async function setup(scopes: ("read" | "deploy")[]) {
  const directory = await mkdtemp(join(tmpdir(), "nelcota-mcp-"));
  const databasePath = join(directory, "test.db");
  const database: Database = openDatabase(databasePath);
  migrateDatabase(database);
  createTestProject(database);
  const { token } = createApiToken(
    database,
    { name: "claude", scopes, expiresAt: null, createdByUserId: null },
    TEST_ACTOR,
  );
  const client = new StdioClient({
    DATABASE_PATH: databasePath,
    NELCOTA_MCP_TOKEN: token,
    LOG_LEVEL: "silent",
  });
  await client.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  });
  client.notify("notifications/initialized");
  return { client, cleanup: async () => await rm(directory, { recursive: true, force: true }) };
}

describe("MCP server over stdio", () => {
  test("lists the platform tools and none that run host commands", async () => {
    const { client, cleanup } = await setup(["read"]);
    await using _client = client;

    const response = await client.request("tools/list");

    const names = ((response.result?.["tools"] ?? []) as { name: string }[])
      .map((tool) => tool.name)
      .toSorted();
    expect(names).toEqual([
      "deploy_project",
      "get_container_status",
      "get_deployment",
      "get_deployment_logs",
      "get_project",
      "get_project_metrics",
      "list_deployments",
      "list_projects",
      "restart_project",
    ]);
    await cleanup();
  }, 20_000);

  test("a read token lists projects", async () => {
    const { client, cleanup } = await setup(["read"]);
    await using _client = client;

    const result = await client.callTool("list_projects", {});

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toMatchObject([{ slug: "api", repository: "acme/api" }]);
    await cleanup();
  }, 20_000);

  test("a read token cannot deploy", async () => {
    const { client, cleanup } = await setup(["read"]);
    await using _client = client;

    const result = await client.callTool("deploy_project", { project: "api" });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('lacks the "deploy" scope');
    await cleanup();
  }, 20_000);

  test("a deploy token queues a deployment", async () => {
    const { client, cleanup } = await setup(["read", "deploy"]);
    await using _client = client;

    const deploy = await client.callTool("deploy_project", { project: "api" });
    const deployments = await client.callTool("list_deployments", { project: "api" });

    expect(JSON.parse(deploy.text)).toMatchObject({ created: true });
    expect(JSON.parse(deployments.text)).toMatchObject([{ status: "queued", trigger: "mcp" }]);
    await cleanup();
  }, 20_000);
});
