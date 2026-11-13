import { expect, test } from "bun:test";

import { httpsRecoveryAt } from "@/shared/https";

import {
  certificateFailureStartedAt,
  certificateWaitStartedAt,
  domainAccess,
  domainProgress,
  manualHttpsIsCurrent,
} from "./domain-access";

const now = new Date("2026-11-13T12:00:00.000Z");
const publishedAt = "2026-11-13T11:58:00.000Z";
const recent = [{ up: true, checkedAt: "2026-11-13T11:59:00.000Z", reason: null }];
const uptime = { status: "up", lastReason: null, recent } as const;
const applied = { pending: false, publishedAt, uptime, now };

test("keeps the first successful check after a certificate failure as the recovery time", () => {
  const failed = { up: false, checkedAt: publishedAt, reason: "certificate" } as const;
  const retry = { up: false, checkedAt: "2026-11-13T11:58:30.000Z", reason: "connection" } as const;

  expect(
    httpsRecoveryAt([
      failed,
      retry,
      ...recent,
      { up: true, checkedAt: now.toISOString(), reason: null },
    ]),
  ).toBe("2026-11-13T11:59:00.000Z");
});

test("does not attribute a subsequent unrelated outage to a certificate", () => {
  const certificate = { up: false, checkedAt: publishedAt, reason: "certificate" } as const;
  const dns = { up: false, checkedAt: "2026-11-13T11:59:30.000Z", reason: "dns" } as const;

  expect(
    httpsRecoveryAt([
      certificate,
      ...recent,
      dns,
      { up: true, checkedAt: now.toISOString(), reason: null },
    ]),
  ).toBeNull();
});

test("does not report recovery while the latest check still fails", () => {
  const certificate = { up: false, checkedAt: now.toISOString(), reason: "certificate" } as const;

  expect(httpsRecoveryAt([...recent, certificate])).toBeNull();
});

test("lets a fresh manual check replace an older observation but yields to newer worker checks", () => {
  const manual = { checkedAt: "2026-11-13T11:59:30.000Z", now };

  expect(manualHttpsIsCurrent({ ...manual, latestCheckAt: publishedAt })).toBe(true);
  expect(manualHttpsIsCurrent({ ...manual, latestCheckAt: now.toISOString() })).toBe(false);
  expect(
    manualHttpsIsCurrent({
      ...manual,
      latestCheckAt: null,
      now: new Date("2026-11-13T12:05:00.000Z"),
    }),
  ).toBe(false);
});

test("holds the open action while saved changes are pending", () => {
  expect(domainAccess({ ...applied, pending: true })).toBe("pending");
});

test("waits for a check after applying the domain", () => {
  expect(domainAccess({ ...applied, publishedAt: now.toISOString() })).toBe("checking");
  expect(domainAccess({ ...applied, uptime: undefined })).toBe("checking");
  expect(domainAccess({ ...applied, now: new Date("2026-11-13T12:05:00.000Z") })).toBe("checking");
  expect(domainAccess({ ...applied, now: new Date("2026-11-13T11:58:50.000Z") })).toBe("ready");
});

test("opens the domain only when the latest check succeeds", () => {
  expect(domainAccess(applied)).toBe("ready");
  const last = { up: false, checkedAt: now.toISOString() };
  expect(
    domainAccess({ ...applied, uptime: { ...uptime, recent: [{ ...last, reason: "dns" }] } }),
  ).toBe("dns");
  expect(
    domainAccess({
      ...applied,
      uptime: { ...uptime, recent: [{ ...last, reason: "connection" }] },
    }),
  ).toBe("unreachable");
});

test("identifies a private domain for manual verification", () => {
  expect(domainAccess({ ...applied, uptime: { ...uptime, status: "private" } })).toBe("private");
});

test("identifies a failed HTTPS certificate check", () => {
  const last = { up: false, checkedAt: now.toISOString(), reason: "certificate" } as const;

  expect(domainAccess({ ...applied, uptime: { ...uptime, recent: [last] } })).toBe("certificate");
});

const propagated = {
  access: "dns",
  dns: { status: "ok", resolved: ["8.8.4.4"] },
  httpsEnabled: true,
  uptime: undefined,
  now,
} as const;

test("shows certificate validation as soon as DNS propagation is confirmed", () => {
  expect(domainProgress(propagated)).toBe("waiting-for-https");
});

test("waits for an HTTP response without mentioning a certificate when HTTPS is off", () => {
  expect(domainProgress({ ...propagated, httpsEnabled: false })).toBe("waiting-for-http");
});

test("requires a successful web check to show the app is ready", () => {
  expect(domainProgress({ ...propagated, access: "ready" })).toBe("ready");
  expect(domainProgress({ ...propagated, access: "unreachable" })).toBe("unreachable");
  expect(domainProgress({ ...propagated, access: "pending" })).toBe("pending");
});

const certificateFailure = {
  up: false,
  checkedAt: now.toISOString(),
  reason: "certificate",
} as const;

test("dates the HTTPS problem from the first failure after a successful check", () => {
  const checks = [
    { ...certificateFailure, checkedAt: publishedAt },
    ...recent,
    { ...certificateFailure, checkedAt: "2026-11-13T11:59:30.000Z" },
    certificateFailure,
  ];

  expect(certificateFailureStartedAt(checks)).toBe("2026-11-13T11:59:30.000Z");
});

test("does not date a certificate failure when the latest check succeeded", () => {
  expect(certificateFailureStartedAt(recent)).toBeNull();
});

test("keeps the observed start of the wait when the first TLS failure is recorded later", () => {
  expect(
    certificateWaitStartedAt({ firstFailureAt: now.toISOString(), firstObservedAt: publishedAt }),
  ).toBe(publishedAt);
});

test("uses a recorded failure older than the current page visit", () => {
  expect(
    certificateWaitStartedAt({ firstFailureAt: publishedAt, firstObservedAt: now.toISOString() }),
  ).toBe(publishedAt);
});

test("allows time for the initial certificate to be issued after a DNS failure", () => {
  const checks = [
    { up: false, checkedAt: publishedAt, reason: "dns" } as const,
    certificateFailure,
  ];

  expect(
    domainProgress({
      ...propagated,
      access: "certificate",
      uptime: { recent: checks, certificateExpiresAt: null },
    }),
  ).toBe("waiting-for-https");
});

test("reports certificate errors immediately for an address that was already working", () => {
  const checks = [...recent, certificateFailure];

  expect(
    domainProgress({
      ...propagated,
      access: "certificate",
      uptime: { recent: checks, certificateExpiresAt: null },
    }),
  ).toBe("certificate");
});

test("reports a certificate problem once the initial wait has elapsed", () => {
  const checks = [
    { ...certificateFailure, checkedAt: "2026-11-13T11:55:00.000Z" },
    certificateFailure,
  ];

  expect(
    domainProgress({
      ...propagated,
      access: "certificate",
      uptime: { recent: checks, certificateExpiresAt: null },
    }),
  ).toBe("certificate");
});
