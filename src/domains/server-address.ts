import { isIP } from "node:net";

/** Resolves a hostname to one address, like `dns.promises.lookup`. */
type Lookup = (hostname: string) => Promise<{ readonly address: string }>;

const IPV4_PRIVATE_PREFIXES = ["10.", "127.", "169.254.", "192.168.", "0."] as const;
// 172.16.0.0/12 is private and 100.64.0.0/10 is carrier-grade NAT.
const IPV4_SHARED_FIRST_OCTET = 172;
const IPV4_SHARED_SECOND_OCTET_MIN = 16;
const IPV4_SHARED_SECOND_OCTET_MAX = 31;
const IPV4_CGNAT_FIRST_OCTET = 100;
const IPV4_CGNAT_SECOND_OCTET_MIN = 64;
const IPV4_CGNAT_SECOND_OCTET_MAX = 127;
const IPV6_LOCAL_PREFIXES = ["::1", "fc", "fd", "fe80", "::"] as const;

/**
 * Tells whether an IP address can be reached from the internet, which a DNS A or AAAA record
 * needs. Loopback, private, link-local and carrier-grade NAT ranges cannot.
 *
 * @param address - IPv4 or IPv6 address.
 * @returns True for a public address; false for local ranges and for text that is not an IP.
 */
export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    if (IPV4_PRIVATE_PREFIXES.some((prefix) => address.startsWith(prefix))) {
      return false;
    }
    const [first, second] = address.split(".").map(Number);
    if (first === IPV4_SHARED_FIRST_OCTET && second != null) {
      return second < IPV4_SHARED_SECOND_OCTET_MIN || second > IPV4_SHARED_SECOND_OCTET_MAX;
    }
    if (first === IPV4_CGNAT_FIRST_OCTET && second != null) {
      return second < IPV4_CGNAT_SECOND_OCTET_MIN || second > IPV4_CGNAT_SECOND_OCTET_MAX;
    }
    return true;
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    return IPV6_LOCAL_PREFIXES.some((prefix) => lower.startsWith(prefix)) === false;
  }
  return false;
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
