/** A project domain as the page lists it; automatic ones have no id and cannot be removed. */
export type DomainItem = {
  readonly id: string | null;
  readonly hostname: string;
  readonly httpsEnabled: boolean;
  readonly automatic: boolean;
};

/** Target of links that take a user to the domain setup. */
export const DOMAIN_SETUP_ID = "configurar-dominio";

/** Target of links to the DNS record for a specific project domain. */
export function dnsRecordId(hostname: string): string {
  return `registro-dns-${hostname}`;
}

/** Anchor for the record fields, below the diagnostic and its logs. */
export function dnsConfigurationId(hostname: string): string {
  return `configurar-dns-${hostname}`;
}

/** Target of links to the certificate history for a specific domain. */
export function certificateHistoryId(hostname: string): string {
  return `historico-https-${hostname}`;
}

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
 * Chooses an address record, or a CNAME fallback for a custom subdomain.
 *
 * @param automaticHostname - The project's automatic hostname, when a base domain is set.
 * @param addressType - Type of the project's known public address.
 * @returns The record type, preferring an address record that also works at the zone apex.
 */
export function dnsRecordType(
  automaticHostname: string | null,
  addressType: "A" | "AAAA" | null = null,
): "A" | "AAAA" | "CNAME" {
  if (addressType != null) {
    return addressType;
  }

  return automaticHostname == null ? "A" : "CNAME";
}

/** What DNS says about a domain, as the server function reports it. */
export type DomainDns = {
  readonly status: "ok" | "elsewhere" | "missing" | "unknown";
  readonly resolved: readonly string[];
};

/**
 * Chooses the tag shown for a domain's DNS.
 *
 * @param dns - Status and resolved addresses, or undefined while the check runs.
 * @returns Label, tone and an explanation for the tooltip; null when there is nothing to show.
 */
export function dnsTag(
  dns: DomainDns | undefined,
): { label: string; tone: "success" | "warning"; detail: string } | null {
  if (dns == null || dns.status === "unknown") {
    return null;
  }
  if (dns.status === "ok") {
    return { label: "DNS ok", tone: "success", detail: "Aponta para o servidor do projeto." };
  }
  if (dns.status === "missing") {
    return {
      label: "Sem DNS",
      tone: "warning",
      detail:
        "Confira o nome e o valor do registro no seu provedor. Se acabou de salvar, aguarde a propagação.",
    };
  }
  return {
    label: "DNS em outro endereço",
    tone: "warning",
    detail: `Aponta para ${dns.resolved.join(", ")}. Se usa um proxy ou CDN, confira o destino nele. Caso contrário, compare com o registro do projeto abaixo.`,
  };
}

/**
 * Tells whether the page should explain which DNS record to create: until every custom domain
 * points at the project's server, or while there is no custom domain yet.
 *
 * @param domains - Domains of the project.
 * @param dns - DNS status of each hostname, possibly not loaded yet.
 * @returns False only when all custom domains already resolve to the right server.
 */
export function needsDnsHelp(
  domains: readonly Pick<DomainItem, "hostname" | "automatic">[],
  dns: ReadonlyMap<string, Pick<DomainDns, "status">>,
): boolean {
  const custom = domains.filter((domain) => domain.automatic === false);
  if (custom.length === 0) {
    return true;
  }
  return custom.some((domain) => dns.get(domain.hostname)?.status !== "ok");
}
