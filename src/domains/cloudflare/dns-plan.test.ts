import { expect, test } from "bun:test";

import { DnsConfigurationError } from "../domain.errors";
import type { CloudflareRecord } from "./cloudflare-api";
import { cloudflareBatch, dnsPlanFingerprint, planDnsRecords, zoneForHostname } from "./dns-plan";

const record: CloudflareRecord = {
  id: "1".repeat(32),
  name: "app.example.com",
  type: "A",
  content: "8.8.8.8",
  ttl: 300,
  proxied: true,
};

test("selects a delegated zone before its parent and handles multi-label public suffixes", () => {
  const zones = [
    { id: "1".repeat(32), name: "example.co.uk", status: "active" },
    { id: "2".repeat(32), name: "apps.example.co.uk", status: "active" },
  ];

  expect(zoneForHostname(zones, "api.apps.example.co.uk").name).toBe("apps.example.co.uk");
  expect(() => zoneForHostname(zones, "example.co.uk.attacker.com")).toThrow(DnsConfigurationError);
});

test("creates an A record at the exact hostname without a proxy when none exists", () => {
  const plan = planDnsRecords({ hostname: record.name, address: "1.1.1.1", records: [] });

  expect(plan.desired).toEqual({
    name: record.name,
    type: "A",
    content: "1.1.1.1",
    ttl: 1,
    proxied: false,
  });
  expect(plan.changes.map((change) => change.action)).toEqual(["create"]);
});

test("updates only the address while preserving proxy and TTL and leaving mail and verification intact", () => {
  const records = [
    record,
    { ...record, id: "2".repeat(32), type: "MX", content: "mail.example.com" },
    { ...record, id: "3".repeat(32), type: "TXT", content: "verification-token" },
  ];

  const plan = planDnsRecords({ hostname: record.name, address: "1.1.1.1", records });
  const body = cloudflareBatch(plan.changes);

  expect(body).toEqual({
    deletes: [],
    posts: [],
    patches: [
      { id: record.id, name: record.name, type: "A", content: "1.1.1.1", ttl: 300, proxied: true },
    ],
  });
});

test("explicitly reviews a conflicting CNAME deletion before creating an address record", () => {
  const plan = planDnsRecords({
    hostname: record.name,
    address: "1.1.1.1",
    records: [{ ...record, type: "CNAME", content: "old.example.com" }],
  });

  expect(plan.changes.map((change) => change.action)).toEqual(["delete", "create"]);
  expect(plan.desired.proxied).toBe(true);
});

test("includes stale IPv6 records in the review when moving to an IPv4-only server", () => {
  const plan = planDnsRecords({
    hostname: record.name,
    address: "1.1.1.1",
    records: [
      record,
      { ...record, id: "2".repeat(32), type: "AAAA", content: "2606:4700:4700::1111" },
    ],
  });

  expect(plan.changes.map((change) => change.action)).toEqual(["delete", "update"]);
});

test("recognizes equivalent IPv6 addresses and avoids unnecessary writes", () => {
  const plan = planDnsRecords({
    hostname: record.name,
    address: "2606:4700:4700::1111",
    records: [{ ...record, type: "AAAA", content: "2606:4700:4700:0:0:0:0:1111" }],
  });

  expect(plan.desired.type).toBe("AAAA");
  expect(plan.changes).toEqual([]);
});

test.each(["", "127.0.0.1", "10.0.0.1", "192.0.2.1", "not-an-address"])(
  "refuses a non-public target %p",
  (address) => {
    expect(() => planDnsRecords({ hostname: record.name, address, records: [] })).toThrow(
      DnsConfigurationError,
    );
  },
);

test.each([
  { ...record, type: "NS", content: "delegated.example.net" },
  { ...record, name: "other.example.com" },
])("refuses delegated or foreign records %p", (existing) => {
  expect(() =>
    planDnsRecords({ hostname: record.name, address: "1.1.1.1", records: [existing] }),
  ).toThrow(DnsConfigurationError);
});

test("refuses a plan with more than one hundred changes", () => {
  const records = Array.from({ length: 100 }, (_, index) =>
    Object.assign({}, record, {
      id: index.toString(16).padStart(32, "0"),
      type: "CNAME",
      content: "old.example.com",
    }),
  );

  expect(() => planDnsRecords({ hostname: record.name, address: "1.1.1.1", records })).toThrow(
    DnsConfigurationError,
  );
});

test("fingerprints record content, connection revision and target independently of listing order", () => {
  const records = [record, { ...record, id: "2".repeat(32), type: "TXT", content: "verification" }];
  const desired = planDnsRecords({ hostname: record.name, address: "1.1.1.1", records }).desired;
  const input = { records, desired, revision: "first", zoneId: "1".repeat(32) };
  const fingerprint = dnsPlanFingerprint(input);

  expect(dnsPlanFingerprint({ ...input, records: records.toReversed() })).toBe(fingerprint);
  expect(dnsPlanFingerprint({ ...input, revision: "second" })).not.toBe(fingerprint);
  expect(dnsPlanFingerprint({ ...input, records: [{ ...record, content: "8.8.4.4" }] })).not.toBe(
    fingerprint,
  );
});

test.each([
  { action: "delete" as const, before: null, after: null },
  { action: "update" as const, before: record, after: null },
  { action: "create" as const, before: null, after: null },
])("rejects malformed internal operations %p", (change) => {
  expect(() => cloudflareBatch([change])).toThrow(Error);
});
