/** A project domain as the page lists it; automatic ones have no id and cannot be removed. */
export type DomainItem = {
  readonly id: string | null;
  readonly hostname: string;
  readonly httpsEnabled: boolean;
  readonly automatic: boolean;
};

/**
 * Builds the address that opens a domain, with the scheme its HTTPS setting serves.
 *
 * @param domain - Hostname and whether HTTPS is on.
 * @returns `https://host` or `http://host`.
 */
export function domainUrl(domain: Pick<DomainItem, "hostname" | "httpsEnabled">): string {
  const scheme = domain.httpsEnabled ? "https" : "http";
  return `${scheme}://${domain.hostname}`;
}

/**
 * Chooses the DNS record a custom domain needs.
 *
 * @param automaticHostname - The project's automatic hostname, when a base domain is set.
 * @returns CNAME to the automatic hostname when there is one, otherwise an A record.
 */
export function dnsRecordType(automaticHostname: string | null): "A" | "CNAME" {
  return automaticHostname == null ? "A" : "CNAME";
}
