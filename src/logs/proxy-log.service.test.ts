import { expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { requestDeployment } from "@/deployments";
import { claimNextJob, completeJob } from "@/jobs";
import { createTestProject, TEST_ACTOR } from "@/testing";

import {
  proxyCertificateErrors,
  proxyLogsSince,
  readProxyCertificateLogs,
  requestProxyCertificateLogs,
  storeProxyCertificateLogs,
} from "./proxy-log.service";

const NOW = new Date("2026-11-13T15:00:00Z");
const HOSTNAME = "app.example.com";
const TIMESTAMP = "2026-11-13T14:30:00.123456789Z";
const LOG_PREFIX = `${TIMESTAMP} 2026-11-13T14:30:00Z ERR github.com/traefik/traefik/v3/pkg/provider/acme/provider.go:458 > Unable to obtain ACME certificate for domains`;

test("summarizes a Traefik certificate error for the exact domain", () => {
  const output = `${TIMESTAMP} 2026-11-13T14:30:00Z ERR Unable to obtain ACME certificate for domains error="DNS problem: NXDOMAIN" domains=["app.example.com"] providerName=letsencrypt.acme`;

  expect(proxyCertificateErrors(output, HOSTNAME)).toEqual([{ time: TIMESTAMP, reason: "dns" }]);
});

test("ignores sibling domains, unrelated logs and domain fields embedded in an error message", () => {
  const output = [
    `${LOG_PREFIX} error="Could not obtain a certificate" domains=["other.app.example.com"]`,
    `${LOG_PREFIX} error="URL contains domains=[app.example.com]" domains=["unrelated.example.com"]`,
    `${LOG_PREFIX} error="Timeout" domains=["app.example.com","unrelated.example.com"]`,
    `${LOG_PREFIX.replace("ERR", "INF")} domains=["app.example.com"]`,
    `${LOG_PREFIX.replace("provider/acme/provider.go", "server/server.go")} domains=["app.example.com"]`,
  ].join("\n");

  expect(proxyCertificateErrors(output, HOSTNAME)).toEqual([]);
});

test("preserves the category and timestamp without exposing the original error", () => {
  const output = `${LOG_PREFIX} error="Connection refused while handling a private token" domain=app.example.com`;

  expect(proxyCertificateErrors(output, HOSTNAME)).toEqual([
    { time: TIMESTAMP, reason: "connection" },
  ]);
});

test("keeps only the stated UTC deadline for a rate limit error", () => {
  const output = `${LOG_PREFIX} error="too many certificates; retry after 2026-11-13 16:05:00 UTC; account details" domain=app.example.com`;

  expect(proxyCertificateErrors(output, HOSTNAME)).toEqual([
    { time: TIMESTAMP, reason: "rate-limit", retryAt: "2026-11-13T16:05:00Z" },
  ]);
});

test("omits an invalid renewal deadline without dropping the rate limit error", () => {
  const output = `${LOG_PREFIX} error="too many certificates; retry after 2026-11-31 16:05:00 UTC" domain=app.example.com`;

  expect(proxyCertificateErrors(output, HOSTNAME)).toEqual([
    { time: TIMESTAMP, reason: "rate-limit" },
  ]);
});

test("reads a renewal failure attributed to a single hostname in the Traefik message", () => {
  const output = `${TIMESTAMP} 2026-11-13T14:30:00Z ERR Error renewing ACME certificate: {app.example.com []} error="ACME request timed out" providerName=letsencrypt.acme`;

  expect(proxyCertificateErrors(output, HOSTNAME)).toEqual([
    { time: TIMESTAMP, reason: "timeout" },
  ]);
});

test("includes errors since the current deploy, up to one day ago", () => {
  expect(proxyLogsSince("2026-11-13T14:00:00Z", NOW)).toBe("2026-11-13T14:00:00.000Z");
  expect(proxyLogsSince("2026-11-01T00:00:00Z", NOW)).toBe("2026-11-12T15:00:00.000Z");
});

test("deduplicates requests and returns the snapshot only for the matching target", () => {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const { deploymentId } = requestDeployment(database, {
    projectId: project.id,
    trigger: "manual",
    actor: TEST_ACTOR,
    triggeredByUserId: null,
  });
  const target = { projectId: project.id, deploymentId, hostname: HOSTNAME };
  const now = new Date();
  const release = claimNextJob(database, "worker", now);
  if (release == null) {
    throw new Error("Expected a queued deployment");
  }

  expect(completeJob(database, release, now)).toBe(true);
  const requestId = requestProxyCertificateLogs(database, target, now);
  const lookup = { ...target, requestId };
  expect(requestProxyCertificateLogs(database, target, now)).toBe(requestId);
  expect(readProxyCertificateLogs(database, lookup, now)).toEqual({ status: "queued" });

  const job = claimNextJob(database, "worker", now);
  if (job == null) {
    throw new Error("Expected a queued proxy log request");
  }

  storeProxyCertificateLogs(database, job, [{ time: TIMESTAMP, reason: "dns" }]);
  expect(completeJob(database, job, now)).toBe(true);
  expect(readProxyCertificateLogs(database, lookup, now)).toEqual({
    status: "ready",
    entries: [{ time: TIMESTAMP, reason: "dns" }],
  });
  expect(
    readProxyCertificateLogs(database, { ...lookup, hostname: "other.example.com" }, now),
  ).toEqual({ status: "unavailable" });
  expect(
    readProxyCertificateLogs(database, { ...lookup, projectId: "other-project" }, now),
  ).toEqual({ status: "unavailable" });
});
