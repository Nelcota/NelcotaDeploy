import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import ipaddr from "ipaddr.js";

const LOOKUP_TIMEOUT_IN_MS = 3000;

/** Resolves a hostname to one address, like `dns.promises.lookup`. */
type Lookup = (hostname: string) => Promise<{ readonly address: string }>;

/**
 * Tells whether an IP address can be reached from the internet, which a DNS A or AAAA record
 * needs. Loopback, private, link-local, carrier-grade NAT, documentation, multicast and other
 * reserved ranges cannot.
 *
 * @param address - IPv4 or IPv6 address; IPv4-mapped IPv6 is judged as IPv4.
 * @returns True for a public address; false for any special range and for text that is not an IP.
 */
export function isPublicIpAddress(address: string): boolean {
  if (ipaddr.isValid(address) === false) {
    return false;
  }
  return ipaddr.process(address).range() === "unicast";
}

/**
 * Finds the public IP address that DNS records for this panel should point at, from the host
 * of its public URL.
 *
 * @param publicUrl - The panel's PUBLIC_URL.
 * @param lookup - Hostname resolver; the real DNS in production, a fake in tests.
 * @returns The public address, or null when the URL is local or does not resolve to one.
 */
export async function resolvePublicAddress(
  publicUrl: string,
  lookup: Lookup,
): Promise<string | null> {
  if (URL.canParse(publicUrl) === false) {
    return null;
  }
  const hostname = new URL(publicUrl).hostname.replaceAll(/^\[|\]$/g, "");
  if (isIP(hostname) !== 0) {
    return isPublicIpAddress(hostname) ? hostname : null;
  }
  const resolved = await lookup(hostname).catch(() => null);
  if (resolved == null || isPublicIpAddress(resolved.address) === false) {
    return null;
  }
  return resolved.address;
}

async function withLookupTimeout<T>(hostname: string, resolving: Promise<T>): Promise<T> {
  const { promise, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => reject(new Error(`DNS lookup of ${hostname} timed out`)),
    LOOKUP_TIMEOUT_IN_MS,
  );
  using _timer = { [Symbol.dispose]: () => clearTimeout(timer) };
  return await Promise.race([resolving, promise]);
}

/**
 * Resolves a hostname to one address, giving up after a few seconds so a slow DNS never
 * hangs a page or a worker duty.
 *
 * @param hostname - Name to resolve.
 * @returns The first address.
 * @throws {Error} When the name does not resolve or the lookup times out.
 */
export async function lookupWithTimeout(hostname: string): Promise<{ readonly address: string }> {
  return await withLookupTimeout(hostname, lookup(hostname));
}

/**
 * Resolves every address of a hostname, giving up after a few seconds.
 *
 * @param hostname - Name to resolve.
 * @returns Its addresses; empty when it does not resolve or the lookup times out.
 */
export async function lookupAllWithTimeout(hostname: string): Promise<string[]> {
  try {
    const resolved = await withLookupTimeout(hostname, lookup(hostname, { all: true }));
    return resolved.map((entry) => entry.address);
  } catch {
    // An unknown name and a timeout mean the same here: it does not point anywhere yet.
    return [];
  }
}
