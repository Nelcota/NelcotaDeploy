import { z } from "zod";

import { type Actor, recordAuditEvent } from "@/audit";
import type { Database } from "@/db";
import type { SecretBox } from "@/secrets";
import { getSystemSettings } from "@/settings";

import { DnsConfigurationError } from "../domain.errors";
import { listProjectDomains } from "../domain.service";
import {
  batchCloudflareRecords,
  CLOUDFLARE_API,
  type CloudflareApi,
  listCloudflareRecords,
  listCloudflareZones,
} from "./cloudflare-api";
import { readCloudflareConnection } from "./cloudflare-connection.service";
import { cloudflareBatch, dnsPlanFingerprint, planDnsRecords, zoneForHostname } from "./dns-plan";
import { dnsOriginAddress } from "./origin-address";

const REVIEW_LIFETIME_IN_MS = 300_000;
const reviewSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  issuedAtInMs: z.number().int().nonnegative(),
});
type DnsDependencies = {
  readonly database: Database;
  readonly secretBox: SecretBox;
  readonly publicUrl: string;
  readonly api?: CloudflareApi;
};
type DnsTarget = { readonly projectId: string; readonly hostname: string };

function reviewContext(target: DnsTarget): string {
  return `dns-review:${target.projectId}:${target.hostname}`;
}

async function inspectDns(dependencies: DnsDependencies, target: DnsTarget) {
  const { database, secretBox } = dependencies;
  const domains = listProjectDomains(database, target.projectId, getSystemSettings(database));
  if (domains.some((domain) => domain.hostname === target.hostname) === false) {
    throw new DnsConfigurationError("unsupported-record");
  }
  const connection = await readCloudflareConnection(database, secretBox);
  const api = dependencies.api ?? CLOUDFLARE_API;
  const zones = await listCloudflareZones(api, connection.token);
  const address = await dnsOriginAddress({
    database,
    projectId: target.projectId,
    publicUrl: dependencies.publicUrl,
    api,
    token: connection.token,
    zones,
  });
  const zone = zoneForHostname(zones, target.hostname);
  const records = await listCloudflareRecords(api, {
    token: connection.token,
    zoneId: zone.id,
    hostname: target.hostname,
  });
  const plan = planDnsRecords({ hostname: target.hostname, address, records });
  const fingerprint = dnsPlanFingerprint({
    zoneId: zone.id,
    revision: connection.revision,
    desired: plan.desired,
    records,
  });
  return { connection, zone, ...plan, fingerprint };
}

/**
 * Builds a read-only review bound to the project's current address and provider records.
 *
 * @param dependencies - Server-side connection and project dependencies.
 * @param target - An existing project domain.
 * @returns Proposed changes and an authenticated, expiring confirmation.
 * @throws {DnsConfigurationError} When the domain, server or connection cannot be configured.
 * @throws {CloudflareApiError} When the provider cannot be read.
 */
export async function previewCloudflareDns(dependencies: DnsDependencies, target: DnsTarget) {
  const plan = await inspectDns(dependencies, target);
  const confirmation = await dependencies.secretBox.encrypt(
    JSON.stringify({ fingerprint: plan.fingerprint, issuedAtInMs: Date.now() }),
    reviewContext(target),
  );
  return {
    hostname: target.hostname,
    zone: plan.zone.name,
    desired: plan.desired,
    changes: plan.changes,
    confirmation,
  };
}

async function validateReview(box: SecretBox, target: DnsTarget, confirmation: string) {
  let value: unknown;
  try {
    value = JSON.parse(await box.decrypt(confirmation, reviewContext(target)));
  } catch {
    throw new DnsConfigurationError("invalid-review");
  }
  const parsed = reviewSchema.safeParse(value);
  if (parsed.success === false) {
    throw new DnsConfigurationError("invalid-review");
  }
  const ageInMs = Date.now() - parsed.data.issuedAtInMs;
  if (Number.isFinite(ageInMs) === false || ageInMs < 0 || ageInMs > REVIEW_LIFETIME_IN_MS) {
    throw new DnsConfigurationError("invalid-review");
  }
  return parsed.data;
}

/**
 * Revalidates and applies exactly the reviewed changes; credentials never enter the response.
 *
 * @param dependencies - Server-side project and provider dependencies.
 * @param input - Domain, reviewed confirmation and authenticated actor.
 * @returns The number of changes submitted and whether the Cloudflare proxy is enabled.
 * @throws {DnsConfigurationError} When the review expired or any reviewed input changed.
 * @throws {CloudflareApiError} When Cloudflare rejects the batch.
 */
export async function applyCloudflareDns(
  dependencies: DnsDependencies,
  input: DnsTarget & { readonly confirmation: string; readonly actor: Actor },
) {
  const review = await validateReview(dependencies.secretBox, input, input.confirmation);
  const plan = await inspectDns(dependencies, input);
  if (plan.fingerprint !== review.fingerprint) {
    throw new DnsConfigurationError("review-changed");
  }
  if (plan.changes.length === 0) {
    return { changed: 0, proxied: plan.desired.proxied };
  }
  await batchCloudflareRecords(dependencies.api ?? CLOUDFLARE_API, {
    token: plan.connection.token,
    zoneId: plan.zone.id,
    body: cloudflareBatch(plan.changes),
  });
  recordAuditEvent(dependencies.database, {
    actor: input.actor,
    action: "domain.dns.configure",
    targetType: "project",
    targetId: input.projectId,
    metadata: {
      hostname: input.hostname,
      zone: plan.zone.name,
      changes: plan.changes.length,
      address: plan.desired.content,
    },
  });
  return { changed: plan.changes.length, proxied: plan.desired.proxied };
}
