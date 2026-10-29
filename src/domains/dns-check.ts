import type { Database } from "@/db";
import { getProject } from "@/projects";
import { getServer } from "@/servers";

import { lookupAllWithTimeout, lookupWithTimeout, resolvePublicAddress } from "./server-address";

/**
 * Where a hostname points compared with the server of its project.
 *
 * - `ok`: it resolves to that server.
 * - `elsewhere`: it resolves, but to other addresses (another server, or a CDN in front).
 * - `missing`: it does not resolve yet.
 * - `unknown`: the server's own address is not known, so nothing can be compared.
 */
type DnsStatus = "ok" | "elsewhere" | "missing" | "unknown";

/**
 * Compares what a hostname resolves to with the address it should point at.
 *
 * @param resolved - Addresses the hostname resolves to; empty when it does not resolve.
 * @param expected - Public address of the project's server, or null when unknown.
 * @returns The status of the hostname.
 */
export function classifyDns(resolved: readonly string[], expected: string | null): DnsStatus {
  if (resolved.length === 0) {
    return "missing";
  }
  if (expected == null) {
    return "unknown";
  }
  return resolved.includes(expected) ? "ok" : "elsewhere";
}

/**
 * Finds the public address DNS records of a project should point at: the address the worker
 * detected for a remote server, or the panel's own address from PUBLIC_URL.
 *
 * @param database - Database.
 * @param projectId - Project id.
 * @param publicUrl - The panel's PUBLIC_URL.
 * @returns The address, or null when it is not known.
 */
export async function projectServerAddress(
  database: Database,
  projectId: string,
  publicUrl: string,
): Promise<string | null> {
  const server = getServer(database, getProject(database, projectId).serverId);
  if (server.kind === "ssh") {
    return server.publicAddress;
  }
  return await resolvePublicAddress(publicUrl, lookupWithTimeout);
}

/**
 * Checks every hostname in parallel against the address it should point at.
 *
 * @param hostnames - Hostnames to check.
 * @param expected - Address they should resolve to, or null when unknown.
 * @returns The status of each hostname.
 */
export async function checkDomainsDns(
  hostnames: readonly string[],
  expected: string | null,
): Promise<{ hostname: string; status: DnsStatus; resolved: string[] }[]> {
  return await Promise.all(
    hostnames.map(async (hostname) => {
      const resolved = await lookupAllWithTimeout(hostname);
      return { hostname, status: classifyDns(resolved, expected), resolved };
    }),
  );
}
