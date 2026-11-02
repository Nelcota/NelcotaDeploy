import { isPublicIpAddress, lookupAllWithTimeout } from "@/domains";

const HTTPS_PORT = 443;
const MAX_HANDSHAKE_TIMEOUT_IN_MS = 60_000;
const MILLISECONDS_PER_DAY = 86_400_000;
/** A certificate this close to expiring gets an alert. */
const CERTIFICATE_WARNING_DAYS = 14;
/** While a certificate stays close to expiring, its alert repeats this often. */
const CERTIFICATE_REMINDER_DAYS = 7;

type CertificateTools = {
  readonly lookup: (hostname: string) => Promise<string[]>;
  readonly connect: (
    options: Bun.TCPSocketConnectOptions<undefined>,
  ) => Promise<Bun.Socket<undefined>>;
};

const networkTools: CertificateTools = { lookup: lookupAllWithTimeout, connect: Bun.connect };

/**
 * Reads when the TLS certificate a hostname serves expires.
 *
 * @remarks
 * The certificate is read even when it is invalid or expired, since those are the ones worth
 * warning about; nothing is sent over the connection, which closes after the handshake.
 *
 * @param hostname - Hostname, also sent as the server name.
 * @param timeoutInMs - How long to wait for the handshake.
 * @param tools - DNS and socket access, replaceable at the network boundary in tests.
 * @returns The expiry, or null when no certificate could be read.
 * @throws {RangeError} When the timeout is not an integer between 1 and 60000 milliseconds.
 */
export async function readCertificateExpiry(
  hostname: string,
  timeoutInMs: number,
  tools: CertificateTools = networkTools,
): Promise<Date | null> {
  if (
    Number.isInteger(timeoutInMs) === false ||
    timeoutInMs < 1 ||
    timeoutInMs > MAX_HANDSHAKE_TIMEOUT_IN_MS
  ) {
    throw new RangeError(`Invalid certificate handshake timeout: ${timeoutInMs}`);
  }
  const addresses = await tools.lookup(hostname);
  const address = addresses[0];
  if (address == null || addresses.some((value) => isPublicIpAddress(value) === false)) {
    return null;
  }
  return await readPublicCertificate({ hostname, address, timeoutInMs }, tools.connect);
}

async function readPublicCertificate(
  target: { readonly hostname: string; readonly address: string; readonly timeoutInMs: number },
  connect: CertificateTools["connect"],
): Promise<Date | null> {
  const { hostname, address, timeoutInMs } = target;
  const { promise, resolve } = Promise.withResolvers<Date | null>();
  let socket: Bun.Socket<undefined> | null = null;
  let finished = false;
  const finish = (expiresAt: Date | null) => {
    if (finished) {
      return;
    }
    finished = true;
    socket?.terminate();
    resolve(expiresAt);
  };
  const timer = setTimeout(() => finish(null), timeoutInMs);
  using _timer = { [Symbol.dispose]: () => clearTimeout(timer) };
  try {
    const connecting = connect({
      hostname: address,
      port: HTTPS_PORT,
      tls: { serverName: hostname, rejectUnauthorized: false },
      socket: {
        handshake(connection) {
          socket = connection;
          finish(expiryOf(connection.getPeerCertificate().valid_to));
        },
        data() {
          // Nothing is ever requested, so any data is ignored.
        },
        error() {
          finish(null);
        },
        connectError() {
          finish(null);
        },
      },
    }).then((connection) => {
      socket = connection;
      if (finished) {
        connection.terminate();
      }
      return promise;
    });
    // The deadline also covers a connection attempt that has not resolved yet.
    return await Promise.race([promise, connecting]);
  } catch {
    // Bun.connect rejects for a host it cannot reach, which has no certificate to read; the
    // uptime check reports such a host as down.
    finish(null);
    return null;
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
