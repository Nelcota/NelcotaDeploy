import { expect, test } from "bun:test";

import { openMemoryDatabase, tables } from "@/db";
import { createTestSecretBox, TEST_ACTOR } from "@/testing";

import { CloudflareApiError, DnsConfigurationError } from "../domain.errors";
import {
  cloudflareConnectionStatus,
  connectCloudflare,
  disconnectCloudflare,
} from "./cloudflare-connection.service";
import { createCloudflareFixture, FIXTURE_TOKEN } from "./cloudflare.fixture";

test("connects with read-only validation and stores only encrypted credentials", async () => {
  await using provider = createCloudflareFixture();
  const database = openMemoryDatabase();
  using _connection = database.$client;

  await connectCloudflare(
    { database, secretBox: await createTestSecretBox(), api: provider.api },
    { token: FIXTURE_TOKEN, actor: TEST_ACTOR },
  );

  expect(cloudflareConnectionStatus(database)).toMatchObject({ configured: true, zoneCount: 1 });
  expect(JSON.stringify(database.select().from(tables.systemSettings).all())).not.toContain(
    FIXTURE_TOKEN,
  );
  expect(JSON.stringify(database.select().from(tables.auditEvents).all())).not.toContain(
    FIXTURE_TOKEN,
  );
  expect(provider.requests.every((request) => request.method === "GET")).toBe(true);
});

test("does not replace a working connection when the new token is rejected", async () => {
  await using provider = createCloudflareFixture();
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const dependencies = { database, secretBox: await createTestSecretBox(), api: provider.api };
  await connectCloudflare(dependencies, { token: FIXTURE_TOKEN, actor: TEST_ACTOR });
  const before = database.select().from(tables.systemSettings).all();
  provider.state.status = 403;

  const error: unknown = await connectCloudflare(dependencies, {
    token: "replacement-fixture-token",
    actor: TEST_ACTOR,
  }).catch((failure: unknown) => failure);

  expect(error).toBeInstanceOf(CloudflareApiError);
  expect(database.select().from(tables.systemSettings).all()).toEqual(before);
});

test("refuses a token without accessible active zones", async () => {
  await using provider = createCloudflareFixture({ zones: [] });
  const database = openMemoryDatabase();
  using _connection = database.$client;

  const error: unknown = await connectCloudflare(
    { database, secretBox: await createTestSecretBox(), api: provider.api },
    { token: FIXTURE_TOKEN, actor: TEST_ACTOR },
  ).catch((failure: unknown) => failure);

  expect(error).toBeInstanceOf(DnsConfigurationError);
  expect(cloudflareConnectionStatus(database).configured).toBe(false);
});

test("disconnects without deleting or changing any provider record", async () => {
  await using provider = createCloudflareFixture();
  const database = openMemoryDatabase();
  using _connection = database.$client;
  await connectCloudflare(
    { database, secretBox: await createTestSecretBox(), api: provider.api },
    { token: FIXTURE_TOKEN, actor: TEST_ACTOR },
  );

  disconnectCloudflare(database, TEST_ACTOR);

  expect(cloudflareConnectionStatus(database).configured).toBe(false);
  expect(provider.requests.every((request) => request.method === "GET")).toBe(true);
});
