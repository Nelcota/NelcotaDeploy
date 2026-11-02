import { notify } from "@/alerts";
import { type LiveDomain, listLiveDomains, lookupAllWithTimeout } from "@/domains";
import { getSystemSettings } from "@/settings";
import {
  certificateAlertDue,
  daysUntil,
  listCertificateStates,
  probeHostname,
  PROBE_TIMEOUT_IN_MS,
  type ProbeTools,
  readCertificateExpiry,
  recordCertificate,
  recordCertificateAlert,
  recordUptimeCheck,
  retainUptimeHostnames,
} from "@/uptime";

import type { WorkerDependencies } from "../worker.types";

/** Hostnames checked at once; more would burst many requests from the panel's server. */
const BATCH_SIZE = 10;

type UptimeDependencies = Pick<WorkerDependencies, "database" | "logger" | "config">;

const networkTools: ProbeTools = {
  lookup: lookupAllWithTimeout,
  fetch,
  now: () => performance.now(),
};

/**
 * Requests every hostname of the live projects as a visitor would and alerts when one goes
 * down (after two failed checks in a row) or comes back.
 *
 * @param dependencies - Database, logger and the panel's public address.
 * @param tools - DNS, fetch and clock; the real ones by default.
 */
export async function checkUptime(
  dependencies: UptimeDependencies,
  tools: ProbeTools = networkTools,
): Promise<void> {
  const { database } = dependencies;
  const domains = listLiveDomains(database, getSystemSettings(database));
  retainUptimeHostnames(
    database,
    domains.map((domain) => domain.hostname),
  );
  await inBatches(domains, async (domain) => await checkDomain(dependencies, domain, tools));
}

async function checkDomain(
  dependencies: UptimeDependencies,
  domain: LiveDomain,
  tools: ProbeTools,
): Promise<void> {
  const { database, logger, config } = dependencies;
  const result = await probeHostname(domain, tools);
  const transition = recordUptimeCheck(database, { target: domain, result, checkedAt: new Date() });
  if (transition == null) {
    return;
  }
  const link = `${config.PUBLIC_URL}/projects/${domain.projectId}/domains`;
  await notify(database, logger, {
    title: transition === "went-down" ? "Domínio fora do ar" : "Resolvido: Domínio fora do ar",
    text:
      transition === "went-down"
        ? `${domain.hostname} (${domain.projectName}) não responde para os visitantes.`
        : `${domain.hostname} (${domain.projectName}) voltou a responder.`,
    link,
  });
}

/**
 * Reads the certificate of every HTTPS hostname of the live projects and alerts when one
 * expires within 14 days, at most once a week per hostname.
 *
 * @param dependencies - Database, logger and the panel's public address.
 * @param readExpiry - Reads a certificate's expiry; the real TLS handshake by default.
 */
export async function checkCertificates(
  dependencies: UptimeDependencies,
  readExpiry: (hostname: string) => Promise<Date | null> = async (hostname) =>
    await readCertificateExpiry(hostname, PROBE_TIMEOUT_IN_MS),
): Promise<void> {
  const { database } = dependencies;
  const domains = listLiveDomains(database, getSystemSettings(database)).filter(
    (domain) => domain.httpsEnabled,
  );
  const states = listCertificateStates(
    database,
    domains.map((domain) => domain.hostname),
  );
  // Only hostnames the uptime check already found public; private ones are never contacted.
  const checked = domains.filter((domain) => states.has(domain.hostname));
  await inBatches(checked, async (domain) => {
    const now = new Date();
    const expiresAt = await readExpiry(domain.hostname);
    recordCertificate(database, domain.hostname, { expiresAt, checkedAt: now });
    const alertedAt = states.get(domain.hostname)?.alertedAt ?? null;
    if (expiresAt == null || certificateAlertDue({ expiresAt, alertedAt }, now) === false) {
      return;
    }
    await alertCertificate(dependencies, domain, { expiresAt, now });
    recordCertificateAlert(database, domain.hostname, now);
  });
}

async function alertCertificate(
  dependencies: UptimeDependencies,
  domain: LiveDomain,
  certificate: { readonly expiresAt: Date; readonly now: Date },
): Promise<void> {
  const days = daysUntil(certificate.expiresAt, certificate.now);
  const text =
    days < 0
      ? `O certificado de ${domain.hostname} (${domain.projectName}) expirou.`
      : `O certificado de ${domain.hostname} (${domain.projectName}) expira em ${days} dia(s).`;
  await notify(dependencies.database, dependencies.logger, {
    title: "Certificado SSL perto de vencer",
    text,
    link: `${dependencies.config.PUBLIC_URL}/projects/${domain.projectId}/domains`,
  });
}

/** Runs the work in fixed-size batches, each finishing before the next starts. */
async function inBatches<T>(items: readonly T[], work: (item: T) => Promise<void>): Promise<void> {
  const [batch, rest] = [items.slice(0, BATCH_SIZE), items.slice(BATCH_SIZE)];
  if (batch.length === 0) {
    return;
  }
  await Promise.all(batch.map(async (item) => await work(item)));
  await inBatches(rest, work);
}
