const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
const LOCAL_SUFFIXES = [".local", ".localhost", ".internal"] as const;

/**
 * Tells whether GitHub could never reach this address, because it points at the machine
 * itself or a name that only resolves on the local network.
 *
 * @param url - Absolute URL, such as the webhook endpoint built from PUBLIC_URL.
 * @returns True for loopback and local-only hosts, and for text that is not a URL.
 */
export function isUnreachableFromInternet(url: string): boolean {
  if (URL.canParse(url) === false) {
    return true;
  }
  const hostname = new URL(url).hostname.toLowerCase();
  return (
    LOCAL_HOSTNAMES.has(hostname) || LOCAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  );
}
