import { describe, expect, test } from "bun:test";

import { certificateAlertDue, daysUntil, expiryOf } from "./certificate";

const NOW = new Date("2026-11-02T12:00:00Z");
const DAY_IN_MS = 86_400_000;

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
