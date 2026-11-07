/** Thrown when a hostname is already routed to a project. */
export class DomainTakenError extends Error {
  constructor(hostname: string) {
    super(`Domain ${hostname} is already in use`);
    this.name = "DomainTakenError";
  }
}

/** Thrown when a domain id does not belong to the project. */
export class DomainNotFoundError extends Error {
  constructor(domainId: string) {
    super(`Domain ${domainId} not found`);
    this.name = "DomainNotFoundError";
  }
}
/** A Cloudflare request failed; credential values and upstream bodies are never included. */
export class CloudflareApiError extends Error {
  readonly status: number | null;
  constructor(status: number | null) {
    super(`Cloudflare request failed with status ${status ?? "unavailable"}`);
    this.name = "CloudflareApiError";
    this.status = status;
  }
}

export type DnsConfigurationReason =
  | "origin-not-found"
  | "not-connected"
  | "zone-not-found"
  | "no-public-address"
  | "unsupported-record"
  | "review-changed"
  | "invalid-review"
  | "too-many-records";

/** A DNS configuration cannot safely be planned or applied. */
export class DnsConfigurationError extends Error {
  readonly reason: DnsConfigurationReason;
  constructor(reason: DnsConfigurationReason) {
    super(`DNS configuration failed: ${reason}`);
    this.name = "DnsConfigurationError";
    this.reason = reason;
  }
}
