import { expect, setSystemTime, test } from "bun:test";

import { openMemoryDatabase, tables } from "@/db";
import { createTestProject, createTestSecretBox, TEST_ACTOR } from "@/testing";

import { CloudflareApiError, DnsConfigurationError } from "../domain.errors";
import { addDomain } from "../domain.service";
import { connectCloudflare, disconnectCloudflare } from "./cloudflare-connection.service";
import { applyCloudflareDns, previewCloudflareDns } from "./cloudflare-dns.service";
import { createCloudflareFixture, FIXTURE_TOKEN, FIXTURE_RECORD } from "./cloudflare.fixture";

async function setup(provider: ReturnType<typeof createCloudflareFixture>) {
  const database = openMemoryDatabase();
  const secretBox = await createTestSecretBox();
  const project = createTestProject(database);
  addDomain(database, {
    projectId: project.id,
    input: { hostname: "app.example.com", httpsEnabled: true },
    actor: TEST_ACTOR,
  });
  const dependencies = { database, secretBox, api: provider.api, publicUrl: "https://1.1.1.1" };
  await connectCloudflare(dependencies, { token: FIXTURE_TOKEN, actor: TEST_ACTOR });
  return { dependencies, target: { projectId: project.id, hostname: "app.example.com" } };
}

test("detects the panel origin behind the Cloudflare proxy and changes only the project's record", async () => {
  const origin = Object.assign({}, FIXTURE_RECORD, {
    id: "c".repeat(32),
    name: "deploy.example.com",
    content: "9.9.9.9",
  });
  await using provider = createCloudflareFixture({ records: [FIXTURE_RECORD, origin] });
  const { dependencies, target } = await setup(provider);
  using _connection = dependencies.database.$client;
  const proxied = { ...dependencies, publicUrl: "https://deploy.example.com" };
  const review = await previewCloudflareDns(proxied, target);
  expect(review.desired.content).toBe("9.9.9.9");
  await applyCloudflareDns(proxied, {
    ...target,
    confirmation: review.confirmation,
    actor: TEST_ACTOR,
  });
  expect(provider.state.records.find((record) => record.name === origin.name)).toEqual(origin);
  expect(provider.state.records.find((record) => record.name === target.hostname)?.content).toBe(
    "9.9.9.9",
  );
});

test("follows panel CNAME records to their public origin without resolving proxy addresses", async () => {
  await using provider = createCloudflareFixture({
    records: [
      FIXTURE_RECORD,
      Object.assign({}, FIXTURE_RECORD, {
        id: "c".repeat(32),
        name: "deploy.example.com",
        type: "CNAME",
        content: "origin.example.com.",
      }),
      Object.assign({}, FIXTURE_RECORD, {
        id: "d".repeat(32),
        name: "origin.example.com",
        content: "9.9.9.9",
      }),
    ],
  });
  const { dependencies, target } = await setup(provider);
  using _connection = dependencies.database.$client;
  const review = await previewCloudflareDns(
    { ...dependencies, publicUrl: "https://deploy.example.com" },
    target,
  );
  expect(review.desired.content).toBe("9.9.9.9");
});

test.each(["ambiguous", "loop", "missing", "private"])(
  "refuses %s panel origins without writing DNS",
  async (mode) => {
    const content = mode === "private" ? "127.0.0.1" : "9.9.9.9";
    const first = Object.assign({}, FIXTURE_RECORD, {
      id: "c".repeat(32),
      name: "deploy.example.com",
      content,
    });
    let records = [first];
    if (mode === "ambiguous") {
      records = [first, Object.assign({}, first, { id: "d".repeat(32), content: "8.8.4.4" })];
    }
    if (mode === "loop") {
      records = [Object.assign({}, first, { type: "CNAME", content: first.name })];
    }
    if (mode === "missing") {
      records = [];
    }
    await using provider = createCloudflareFixture({ records });
    const { dependencies, target } = await setup(provider);
    using _connection = dependencies.database.$client;
    const error: unknown = await previewCloudflareDns(
      { ...dependencies, publicUrl: "https://deploy.example.com" },
      target,
    ).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(DnsConfigurationError);
    expect(provider.requests.some((request) => request.method === "POST")).toBe(false);
  },
);

test("preview only reads; confirmed apply revalidates, batches once and audits without credentials", async () => {
  await using provider = createCloudflareFixture();
  const { dependencies, target } = await setup(provider);
  using _connection = dependencies.database.$client;

  const review = await previewCloudflareDns(dependencies, target);
  expect(provider.requests.every((request) => request.method === "GET")).toBe(true);
  const result = await applyCloudflareDns(dependencies, {
    ...target,
    confirmation: review.confirmation,
    actor: TEST_ACTOR,
  });

  expect(result).toEqual({ changed: 1, proxied: true });
  expect(provider.requests.filter((request) => request.method === "POST")).toHaveLength(1);
  expect(provider.state.records.at(0)?.content).toBe("1.1.1.1");
  expect(JSON.stringify(review)).not.toContain(FIXTURE_TOKEN);
  expect(
    JSON.stringify(dependencies.database.select().from(tables.auditEvents).all()),
  ).not.toContain(FIXTURE_TOKEN);
});

test("rejects a review when records changed externally and performs no writes", async () => {
  await using provider = createCloudflareFixture();
  const { dependencies, target } = await setup(provider);
  using _connection = dependencies.database.$client;
  const review = await previewCloudflareDns(dependencies, target);
  provider.state.records = provider.state.records.map((record) =>
    Object.assign({}, record, { content: "8.8.4.4" }),
  );

  const error: unknown = await applyCloudflareDns(dependencies, {
    ...target,
    confirmation: review.confirmation,
    actor: TEST_ACTOR,
  }).catch((failure: unknown) => failure);

  expect(error).toBeInstanceOf(DnsConfigurationError);
  expect(provider.requests.some((request) => request.method === "POST")).toBe(false);
  expect(provider.state.records.at(0)?.content).toBe("8.8.4.4");
});

test("rejects a review after the server address changes", async () => {
  await using provider = createCloudflareFixture();
  const { dependencies, target } = await setup(provider);
  using _connection = dependencies.database.$client;
  const review = await previewCloudflareDns(dependencies, target);

  const error: unknown = await applyCloudflareDns(
    { ...dependencies, publicUrl: "https://8.8.4.4" },
    { ...target, confirmation: review.confirmation, actor: TEST_ACTOR },
  ).catch((failure: unknown) => failure);

  expect(error).toBeInstanceOf(DnsConfigurationError);
  expect(provider.requests.some((request) => request.method === "POST")).toBe(false);
});

test("rejects a review after the provider connection is replaced", async () => {
  await using provider = createCloudflareFixture();
  const { dependencies, target } = await setup(provider);
  using _connection = dependencies.database.$client;
  const review = await previewCloudflareDns(dependencies, target);
  await connectCloudflare(dependencies, { token: FIXTURE_TOKEN, actor: TEST_ACTOR });

  const error: unknown = await applyCloudflareDns(dependencies, {
    ...target,
    confirmation: review.confirmation,
    actor: TEST_ACTOR,
  }).catch((failure: unknown) => failure);

  expect(error).toBeInstanceOf(DnsConfigurationError);
  expect(provider.requests.some((request) => request.method === "POST")).toBe(false);
});

test("refuses tampered confirmations before contacting the provider", async () => {
  await using provider = createCloudflareFixture();
  const { dependencies, target } = await setup(provider);
  using _connection = dependencies.database.$client;
  const requestCount = provider.requests.length;

  const error: unknown = await applyCloudflareDns(dependencies, {
    ...target,
    confirmation: "tampered",
    actor: TEST_ACTOR,
  }).catch((failure: unknown) => failure);

  expect(error).toBeInstanceOf(DnsConfigurationError);
  expect(provider.requests).toHaveLength(requestCount);
});

test("expires reviews after five minutes without writing DNS", async () => {
  setSystemTime(new Date("2026-11-06T12:00:00Z"));
  using _clock = { [Symbol.dispose]: () => setSystemTime() };
  await using provider = createCloudflareFixture();
  const { dependencies, target } = await setup(provider);
  using _connection = dependencies.database.$client;
  const review = await previewCloudflareDns(dependencies, target);
  setSystemTime(new Date("2026-11-06T12:05:01Z"));

  const error: unknown = await applyCloudflareDns(dependencies, {
    ...target,
    confirmation: review.confirmation,
    actor: TEST_ACTOR,
  }).catch((failure: unknown) => failure);

  expect(error).toBeInstanceOf(DnsConfigurationError);
  expect(provider.requests.some((request) => request.method === "POST")).toBe(false);
});

test("refuses any hostname that is not currently registered to the project", async () => {
  await using provider = createCloudflareFixture();
  const { dependencies, target } = await setup(provider);
  using _connection = dependencies.database.$client;

  const error: unknown = await previewCloudflareDns(dependencies, {
    ...target,
    hostname: "foreign.example.com",
  }).catch((failure: unknown) => failure);

  expect(error).toBeInstanceOf(DnsConfigurationError);
  expect(provider.requests.some((request) => request.method === "POST")).toBe(false);
});

test("does not audit a successful DNS change when Cloudflare rejects the batch", async () => {
  await using provider = createCloudflareFixture();
  const { dependencies, target } = await setup(provider);
  using _connection = dependencies.database.$client;
  const review = await previewCloudflareDns(dependencies, target);
  provider.state.batchStatus = 403;

  const error: unknown = await applyCloudflareDns(dependencies, {
    ...target,
    confirmation: review.confirmation,
    actor: TEST_ACTOR,
  }).catch((failure: unknown) => failure);

  expect(error).toBeInstanceOf(CloudflareApiError);
  expect(
    dependencies.database
      .select()
      .from(tables.auditEvents)
      .all()
      .filter((event) => event.action === "domain.dns.configure"),
  ).toEqual([]);
});

test("disconnecting invalidates outstanding reviews without touching records", async () => {
  await using provider = createCloudflareFixture();
  const { dependencies, target } = await setup(provider);
  using _connection = dependencies.database.$client;
  const review = await previewCloudflareDns(dependencies, target);
  disconnectCloudflare(dependencies.database, TEST_ACTOR);

  const error: unknown = await applyCloudflareDns(dependencies, {
    ...target,
    confirmation: review.confirmation,
    actor: TEST_ACTOR,
  }).catch((failure: unknown) => failure);

  expect(error).toBeInstanceOf(DnsConfigurationError);
  expect(provider.requests.some((request) => request.method === "POST")).toBe(false);
});
