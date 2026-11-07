import { expect, test } from "bun:test";

import { CloudflareApiError, DnsConfigurationError } from "../domain.errors";
import {
  batchCloudflareRecords,
  listCloudflareRecords,
  listCloudflareZones,
} from "./cloudflare-api";
import { createCloudflareFixture, FIXTURE_RECORD, FIXTURE_TOKEN } from "./cloudflare.fixture";

test("discovers zones on subsequent pages instead of planning from a partial account", async () => {
  const zones = Array.from({ length: 51 }, (_, index) => ({
    id: index.toString(16).padStart(32, "0"),
    name: `zone-${index}.example.com`,
    status: "active",
  }));
  await using provider = createCloudflareFixture({ zones });
  const found = await listCloudflareZones(provider.api, FIXTURE_TOKEN);
  expect(found).toEqual(zones);
  expect(provider.requests).toHaveLength(2);
});

test("reads all exact-name records before computing a replacement", async () => {
  const records = Array.from({ length: 51 }, (_, index) =>
    Object.assign({}, FIXTURE_RECORD, {
      id: index.toString(16).padStart(32, "0"),
      type: "TXT",
      content: `verification-${index}`,
    }),
  );
  await using provider = createCloudflareFixture({ records });
  const found = await listCloudflareRecords(provider.api, {
    token: FIXTURE_TOKEN,
    zoneId: "a".repeat(32),
    hostname: FIXTURE_RECORD.name,
  });
  expect(found).toEqual(records);
  expect(provider.requests).toHaveLength(2);
});

test("refuses to truncate records when the pagination safety limit is reached", async () => {
  const records = Array.from({ length: 201 }, (_, index) =>
    Object.assign({}, FIXTURE_RECORD, { id: index.toString(16).padStart(32, "0"), type: "TXT" }),
  );
  await using provider = createCloudflareFixture({ records });
  const error: unknown = await listCloudflareRecords(provider.api, {
    token: FIXTURE_TOKEN,
    zoneId: "a".repeat(32),
    hostname: FIXTURE_RECORD.name,
  }).catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(DnsConfigurationError);
  expect(provider.requests).toHaveLength(4);
});

test("rejects malformed provider data instead of treating it as an empty zone", async () => {
  await using provider = createCloudflareFixture({
    zones: [{ id: "invalid", name: "example.com", status: "active" }],
  });
  const error: unknown = await listCloudflareZones(provider.api, FIXTURE_TOKEN).catch(
    (failure: unknown) => failure,
  );
  expect(error).toBeInstanceOf(CloudflareApiError);
});

test("does not retry a rejected batch of reviewed DNS mutations", async () => {
  await using provider = createCloudflareFixture();
  provider.state.batchStatus = 500;
  const failure: unknown = await batchCloudflareRecords(provider.api, {
    token: FIXTURE_TOKEN,
    zoneId: "a".repeat(32),
    body: { deletes: [], patches: [], posts: [] },
  }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(CloudflareApiError);
  expect(provider.requests).toHaveLength(1);
  expect(provider.requests.at(0)?.method).toBe("POST");
});
