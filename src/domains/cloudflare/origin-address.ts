import { isIP } from "node:net";

import type { Database } from "@/db";
import { getProject } from "@/projects";
import { getServer } from "@/servers";
import { isValidHostname } from "@/shared/schemas/domain.schema";

import { DnsConfigurationError } from "../domain.errors";
import { isPublicIpAddress } from "../server-address";
import { type CloudflareApi, type CloudflareZone, listCloudflareRecords } from "./cloudflare-api";

const MAX_ALIAS_DEPTH = 4;

async function cloudflareOrigin(
  api: CloudflareApi,
  input: {
    readonly zones: readonly CloudflareZone[];
    readonly token: string;
    readonly hostname: string;
    readonly visited: ReadonlySet<string>;
  },
): Promise<string> {
  if (
    input.visited.size >= MAX_ALIAS_DEPTH ||
    input.visited.has(input.hostname) ||
    isValidHostname(input.hostname) === false
  ) {
    throw new DnsConfigurationError("origin-not-found");
  }
  const zone = input.zones
    .filter(
      (candidate) =>
        input.hostname === candidate.name || input.hostname.endsWith(`.${candidate.name}`),
    )
    .toSorted((first, second) => second.name.length - first.name.length)
    .at(0);
  if (zone == null) {
    throw new DnsConfigurationError("origin-not-found");
  }
  const records = await listCloudflareRecords(api, {
    token: input.token,
    zoneId: zone.id,
    hostname: input.hostname,
  });
  const ipv4 = records.filter((record) => record.type === "A" && isPublicIpAddress(record.content));
  const firstIpv4 = ipv4.at(0);
  if (ipv4.length === 1 && firstIpv4 != null) {
    return firstIpv4.content;
  }
  const ipv6 = records.filter(
    (record) => record.type === "AAAA" && isPublicIpAddress(record.content),
  );
  const firstIpv6 = ipv6.at(0);
  if (ipv4.length === 0 && ipv6.length === 1 && firstIpv6 != null) {
    return firstIpv6.content;
  }
  const alias = records.find((record) => record.type === "CNAME");
  if (ipv4.length > 0 || ipv6.length > 0 || alias == null) {
    throw new DnsConfigurationError("origin-not-found");
  }
  return await cloudflareOrigin(api, {
    ...input,
    hostname: alias.content.replace(/\.$/, ""),
    visited: input.visited.union(new Set([input.hostname])),
  });
}

/** Finds the origin behind the panel's proxy instead of pointing projects at Cloudflare's edge IPs. */
export async function dnsOriginAddress(input: {
  readonly database: Database;
  readonly projectId: string;
  readonly publicUrl: string;
  readonly api: CloudflareApi;
  readonly token: string;
  readonly zones: readonly CloudflareZone[];
}): Promise<string> {
  const server = getServer(input.database, getProject(input.database, input.projectId).serverId);
  if (server.publicAddress != null && isPublicIpAddress(server.publicAddress)) {
    return server.publicAddress;
  }
  if (server.host != null && isPublicIpAddress(server.host)) {
    return server.host;
  }
  if (server.kind !== "local" || URL.canParse(input.publicUrl) === false) {
    throw new DnsConfigurationError("no-public-address");
  }
  const hostname = new URL(input.publicUrl).hostname.replaceAll(/^\[|\]$/g, "");
  if (isIP(hostname) !== 0) {
    if (isPublicIpAddress(hostname) === false) {
      throw new DnsConfigurationError("no-public-address");
    }
    return hostname;
  }
  return await cloudflareOrigin(input.api, {
    zones: input.zones,
    token: input.token,
    hostname,
    visited: new Set(),
  });
}
