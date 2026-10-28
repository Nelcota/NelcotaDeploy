import { isIP } from "node:net";

import ipaddr from "ipaddr.js";

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
  const hostname = new URL(publicUrl).hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) !== 0) {
    return isPublicIpAddress(hostname) ? hostname : null;
  }
  const resolved = await lookup(hostname).catch(() => null);
  if (resolved == null || isPublicIpAddress(resolved.address) === false) {
    return null;
  }
  return resolved.address;
}
