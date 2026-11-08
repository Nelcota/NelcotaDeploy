import ipaddr from "ipaddr.js";

import { DnsConfigurationError } from "../domain.errors";
import { isPublicIpAddress } from "../server-address";
import type { CloudflareBatch, CloudflareRecord, CloudflareZone } from "./cloudflare-api";

const MAX_CHANGES = 100;
const AUTOMATIC_TTL_IN_SECONDS = 1;
const ADDRESS_TYPES: ReadonlySet<string> = new Set(["A", "AAAA", "CNAME"]);

export type DesiredDnsRecord = {
  readonly name: string;
  readonly type: "A" | "AAAA";
  readonly content: string;
  readonly ttl: number;
  readonly proxied: boolean;
};
export type DnsChange = {
  readonly action: "create" | "update" | "delete";
  readonly before: CloudflareRecord | null;
  readonly after: DesiredDnsRecord | null;
};

/** Selects the most specific authorized zone, including delegated zones and multi-label suffixes. */
export function zoneForHostname(
  zones: readonly CloudflareZone[],
  hostname: string,
): CloudflareZone {
  const zone = zones
    .filter(
      (candidate) =>
        candidate.status === "active" &&
        (hostname === candidate.name || hostname.endsWith(`.${candidate.name}`)),
    )
    .toSorted((first, second) => second.name.length - first.name.length)
    .at(0);
  if (zone == null) {
    throw new DnsConfigurationError("zone-not-found");
  }
  return zone;
}

function addressMatches(record: CloudflareRecord, target: DesiredDnsRecord): boolean {
  return (
    record.type === target.type &&
    ipaddr.isValid(record.content) &&
    ipaddr.process(record.content).toString() === target.content
  );
}

/** Plans changes only to address records at this exact hostname; mail and verification records remain intact. */
export function planDnsRecords(input: {
  readonly hostname: string;
  readonly address: string;
  readonly records: readonly CloudflareRecord[];
}) {
  if (isPublicIpAddress(input.address) === false) {
    throw new DnsConfigurationError("no-public-address");
  }
  if (input.records.some((record) => record.name !== input.hostname || record.type === "NS")) {
    throw new DnsConfigurationError("unsupported-record");
  }
  const address = ipaddr.process(input.address);
  const addresses = input.records.filter((record) => ADDRESS_TYPES.has(record.type));
  const target: DesiredDnsRecord = {
    name: input.hostname,
    type: address.kind() === "ipv4" ? "A" : "AAAA",
    content: address.toString(),
    ttl: AUTOMATIC_TTL_IN_SECONDS,
    proxied: false,
  };
  const primary =
    addresses.find((record) => addressMatches(record, target)) ??
    addresses.find((record) => record.type === target.type);
  const inherited = primary ?? addresses.at(0);
  const desired = {
    ...target,
    ttl: inherited?.ttl ?? AUTOMATIC_TTL_IN_SECONDS,
    proxied: inherited?.proxied ?? false,
  };
  const changes: DnsChange[] = addresses
    .filter((record) => record.id !== primary?.id)
    .map((record) => ({ action: "delete", before: record, after: null }));
  if (primary == null) {
    changes.push({ action: "create", before: null, after: desired });
  }
  if (primary != null && addressMatches(primary, desired) === false) {
    changes.push({ action: "update", before: primary, after: desired });
  }
  if (changes.length > MAX_CHANGES) {
    throw new DnsConfigurationError("too-many-records");
  }
  return { desired, changes };
}

export function dnsPlanFingerprint(input: {
  readonly zoneId: string;
  readonly revision: string;
  readonly desired: DesiredDnsRecord;
  readonly records: readonly CloudflareRecord[];
}): string {
  const records = input.records.toSorted((first, second) => first.id.localeCompare(second.id));
  return new Bun.CryptoHasher("sha256").update(JSON.stringify({ ...input, records })).digest("hex");
}

export function cloudflareBatch(changes: readonly DnsChange[]): CloudflareBatch {
  const deletes = changes
    .filter((change) => change.action === "delete")
    .map((change) => {
      if (change.before == null) {
        throw new Error("DNS deletion has no source record");
      }
      return { id: change.before.id };
    });
  const patches = changes
    .filter((change) => change.action === "update")
    .map((change) => {
      if (change.before == null || change.after == null) {
        throw new Error("DNS update has no source or target record");
      }
      return Object.assign({ id: change.before.id }, change.after);
    });
  const posts = changes
    .filter((change) => change.action === "create")
    .map((change) => {
      if (change.after == null) {
        throw new Error("DNS creation has no target record");
      }
      return change.after;
    });
  return { deletes, patches, posts };
}
