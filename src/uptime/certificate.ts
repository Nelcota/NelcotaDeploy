const HTTPS_PORT = 443;
const MILLISECONDS_PER_DAY = 86_400_000;
/** A certificate this close to expiring gets an alert. */
const CERTIFICATE_WARNING_DAYS = 14;
/** While a certificate stays close to expiring, its alert repeats this often. */
const CERTIFICATE_REMINDER_DAYS = 7;

/**
 * Reads when the TLS certificate a hostname serves expires.
 *
 * @remarks
 * The certificate is read even when it is invalid or expired, since those are the ones worth
 * warning about; nothing is sent over the connection, which closes after the handshake.
 *
 * @param hostname - Hostname, also sent as the server name.
 * @param timeoutInMs - How long to wait for the handshake.
 * @returns The expiry, or null when no certificate could be read.
 */
export async function readCertificateExpiry(
  hostname: string,
  timeoutInMs: number,
): Promise<Date | null> {
  const { promise, resolve } = Promise.withResolvers<Date | null>();
  const timer = setTimeout(() => resolve(null), timeoutInMs);
  try {
    const socket = await Bun.connect({
      hostname,
      port: HTTPS_PORT,
      tls: { serverName: hostname, rejectUnauthorized: false },
      socket: {
        handshake(connection) {
          resolve(expiryOf(connection.getPeerCertificate().valid_to));
          connection.end();
        },
        data() {
          // Nothing is ever requested, so any data is ignored.
        },
        error() {
          resolve(null);
        },
        connectError() {
          resolve(null);
        },
      },
    });
    const expiresAt = await promise;
    socket.end();
    return expiresAt;
  } catch {
    // Bun.connect rejects for a host it cannot reach, which has no certificate to read; the
    // uptime check reports such a host as down.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parses the expiry OpenSSL prints for a certificate, such as "Nov 20 12:00:00 2026 GMT".
 *
 * @param validTo - The `valid_to` field of the certificate; empty when there is none.
 * @returns The expiry, or null when it is missing or not a date.
 */
export function expiryOf(validTo: string | undefined): Date | null {
  if (validTo == null || validTo.trim() === "") {
    return null;
  }
  const expiresAt = new Date(validTo);
  return Number.isNaN(expiresAt.getTime()) ? null : expiresAt;
}

/**
 * Tells whether a certificate needs an alert now: it expires within 14 days and no alert went
 * out in the last 7.
 *
 * @param certificate - When it expires and when it was last alerted, if ever.
 * @param now - Current time.
 * @returns True when an alert is due.
 */
export function certificateAlertDue(
  certificate: { readonly expiresAt: Date; readonly alertedAt: Date | null },
  now: Date,
): boolean {
  const daysLeft = (certificate.expiresAt.getTime() - now.getTime()) / MILLISECONDS_PER_DAY;
  if (daysLeft > CERTIFICATE_WARNING_DAYS) {
    return false;
  }
  if (certificate.alertedAt == null) {
    return true;
  }
  const daysSinceAlert = (now.getTime() - certificate.alertedAt.getTime()) / MILLISECONDS_PER_DAY;
  return daysSinceAlert >= CERTIFICATE_REMINDER_DAYS;
}

/**
 * Counts the whole days left before a certificate expires.
 *
 * @param expiresAt - Expiry of the certificate.
 * @param now - Current time.
 * @returns Days left, rounded down; negative once expired.
 */
export function daysUntil(expiresAt: Date, now: Date): number {
  return Math.floor((expiresAt.getTime() - now.getTime()) / MILLISECONDS_PER_DAY);
}
