import { describe, expect, test } from "bun:test";

import { certificateAlertDue, daysUntil, expiryOf, readCertificateExpiry } from "./certificate";

const NOW = new Date("2026-11-02T12:00:00Z");
const DAY_IN_MS = 86_400_000;

type CertificateTools = NonNullable<Parameters<typeof readCertificateExpiry>[2]>;

function certificateTools(addresses = ["1.1.1.1"]) {
  const contacted: string[] = [];
  const tools: CertificateTools = {
    lookup: async () => await Promise.resolve(addresses),
    connect: async (options) => {
      contacted.push(options.hostname);
      return await Promise.reject(new Error("TLS connection refused"));
    },
  };
  return { tools, contacted };
}

test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 60_001])(
  "rejects an invalid certificate timeout %p",
  async (timeoutInMs) => {
    const { tools } = certificateTools();

    const error = await readCertificateExpiry("example.com", timeoutInMs, tools).catch(
      (failure: unknown) => failure,
    );

    expect(error).toBeInstanceOf(RangeError);
  },
);

test("connects to the checked address with the original TLS server name", async () => {
  const { tools, contacted } = certificateTools();
  const serverNames: (string | undefined)[] = [];
  const connect: CertificateTools["connect"] = async (options) => {
    if (typeof options.tls === "object") {
      serverNames.push(options.tls.serverName);
    }
    return await tools.connect(options);
  };

  const expiry = await readCertificateExpiry("example.com", 1000, { ...tools, connect });

  expect(expiry).toBeNull();
  expect(contacted).toEqual(["1.1.1.1"]);
  expect(serverNames).toEqual(["example.com"]);
});

test("does not connect when DNS has changed to a private address", async () => {
  const { tools, contacted } = certificateTools(["127.0.0.1"]);

  const expiry = await readCertificateExpiry("example.com", 1000, tools);

  expect(expiry).toBeNull();
  expect(contacted).toEqual([]);
});

test("bounds a connection attempt that never resolves", async () => {
  const { tools } = certificateTools();
  const connect: CertificateTools["connect"] = () =>
    Promise.withResolvers<Bun.Socket<undefined>>().promise;

  const expiry = await readCertificateExpiry("example.com", 10, { ...tools, connect });

  expect(expiry).toBeNull();
});

function inDays(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_IN_MS);
}

describe("certificateAlertDue", () => {
  test("alerts when the certificate expires within 14 days", () => {
    expect(certificateAlertDue({ expiresAt: inDays(14), alertedAt: null }, NOW)).toBe(true);
  });

  test("stays quiet for a certificate with more than 14 days left", () => {
    expect(certificateAlertDue({ expiresAt: inDays(15), alertedAt: null }, NOW)).toBe(false);
  });

  test("alerts for a certificate that already expired", () => {
    expect(certificateAlertDue({ expiresAt: inDays(-1), alertedAt: null }, NOW)).toBe(true);
  });

  test("stays quiet for a week after the last alert", () => {
    const certificate = { expiresAt: inDays(5), alertedAt: inDays(-6) };

    expect(certificateAlertDue(certificate, NOW)).toBe(false);
  });

  test("alerts again a week after the last alert", () => {
    const certificate = { expiresAt: inDays(5), alertedAt: inDays(-7) };

    expect(certificateAlertDue(certificate, NOW)).toBe(true);
  });
});

describe("daysUntil", () => {
  test("counts whole days left", () => {
    expect(daysUntil(new Date(inDays(3).getTime() + 1000), NOW)).toBe(3);
  });

  test("is negative once expired", () => {
    expect(daysUntil(inDays(-2), NOW)).toBe(-2);
  });
});

describe("expiryOf", () => {
  test("parses the date OpenSSL prints", () => {
    expect(expiryOf("Jan 27 23:59:59 2027 GMT")?.toISOString()).toBe("2027-01-27T23:59:59.000Z");
  });

  test.each([[undefined], [""], ["  "], ["not a date"]])("returns null for %p", (validTo) => {
    expect(expiryOf(validTo)).toBeNull();
  });
});
