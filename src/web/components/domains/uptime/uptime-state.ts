import { formatDate, formatDuration, formatPercent } from "@/shared/format";

/** Availability of one hostname, as the server function returns it. */
export type DomainUptime = {
  readonly hostname: string;
  readonly status: "unknown" | "up" | "down" | "private";
  readonly uptimeLastDayPercent: number | null;
  readonly uptimeLastWeekPercent: number | null;
  readonly lastResponseTimeInMs: number | null;
  readonly lastReason: "dns" | "timeout" | "certificate" | "connection" | "server-error" | null;
  readonly certificateExpiresAt: string | null;
  readonly recent: readonly { readonly up: boolean; readonly checkedAt: string }[];
};

/** What the domain row shows about its availability. */
export type UptimeView = {
  readonly label: string;
  readonly tone: "neutral" | "warning" | "success";
  /** Figures of the last day and week; null before any check. */
  readonly figures: string | null;
  /** Why the last check failed, when it did. */
  readonly failure: string | null;
  readonly certificate: { readonly text: string; readonly expiring: boolean } | null;
};

const MILLISECONDS_PER_DAY = 86_400_000;
const CERTIFICATE_WARNING_DAYS = 14;

const STATUS_LABELS = {
  unknown: "Verificando",
  up: "No ar",
  down: "Fora do ar",
  private: "Endereço privado",
} as const satisfies Record<DomainUptime["status"], string>;

const REASON_TEXTS = {
  dns: "O nome não resolve no DNS.",
  timeout: "Não respondeu em 10 segundos.",
  certificate: "O certificado HTTPS é inválido.",
  connection: "A conexão foi recusada.",
  "server-error": "Respondeu com erro do servidor (5xx).",
} as const satisfies Record<NonNullable<DomainUptime["lastReason"]>, string>;

/**
 * Describes a hostname's availability for its row on the domains page.
 *
 * @param uptime - Its summary.
 * @param now - Current time, for the certificate warning.
 * @returns Tag, figures, last failure and certificate expiry.
 */
export function describeUptime(uptime: DomainUptime, now: Date): UptimeView {
  return {
    label: STATUS_LABELS[uptime.status],
    tone: toneOf(uptime.status),
    figures: figuresOf(uptime),
    failure: uptime.lastReason == null ? null : REASON_TEXTS[uptime.lastReason],
    certificate: certificateOf(uptime.certificateExpiresAt, now),
  };
}

function toneOf(status: DomainUptime["status"]): UptimeView["tone"] {
  if (status === "up") {
    return "success";
  }
  return status === "down" ? "warning" : "neutral";
}

function figuresOf(uptime: DomainUptime): string | null {
  if (uptime.uptimeLastDayPercent == null && uptime.uptimeLastWeekPercent == null) {
    return null;
  }
  const parts = [
    `${formatPercent(uptime.uptimeLastDayPercent)} em 24 h`,
    `${formatPercent(uptime.uptimeLastWeekPercent)} em 7 dias`,
  ];
  if (uptime.lastResponseTimeInMs != null) {
    parts.push(`resposta em ${formatDuration(uptime.lastResponseTimeInMs)}`);
  }
  return parts.join(" · ");
}

function certificateOf(expiresAt: string | null, now: Date): UptimeView["certificate"] {
  if (expiresAt == null) {
    return null;
  }
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) {
    return null;
  }
  const daysLeft = (expiry.getTime() - now.getTime()) / MILLISECONDS_PER_DAY;
  if (daysLeft < 0) {
    return { text: `Certificado expirou em ${formatDate(expiresAt)}`, expiring: true };
  }
  return {
    text: `Certificado válido até ${formatDate(expiresAt)}`,
    expiring: daysLeft <= CERTIFICATE_WARNING_DAYS,
  };
}
