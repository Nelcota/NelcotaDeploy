import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";

import { type Database, tables } from "@/db";
import { assertJobOwnership, enqueueJob, type Job } from "@/jobs";

const SNAPSHOT_LIFETIME_IN_MS = 900_000;
const REFRESH_COOLDOWN_IN_MS = 10_000;
const MAX_ERRORS = 20;
const PROXY_LOG_TTL_IN_MS = 86_400_000;
const entrySchema = z.object({
  time: z.iso.datetime(),
  reason: z.enum(["dns", "timeout", "connection", "challenge", "rate-limit", "other"]),
  retryAt: z.iso.datetime().optional(),
});
const entriesSchema = z.array(entrySchema).max(MAX_ERRORS);
type Entry = z.infer<typeof entrySchema>;

type ProxyLogTarget = {
  readonly projectId: string;
  readonly deploymentId: string;
  readonly hostname: string;
};

/** Reads only errors explicitly attributed by Traefik to this exact certificate hostname. */
export function proxyCertificateErrors(output: string, hostname: string): Entry[] {
  const entries: Entry[] = [];
  for (const rawLine of output.split("\n")) {
    const line = Bun.stripANSI(rawLine);
    const match = line.match(
      /^(\S+) \S+ ERR (?:github\.com\/traefik\/traefik\/v3\/pkg\/provider\/acme\/\S+ > )?([^=]+?)(?= \w+=|$)/u,
    );
    const timestamp = match?.[1];
    const message = match?.[2];
    if (
      timestamp == null ||
      message == null ||
      /^(?:Unable to obtain ACME certificate|Error renewing ACME certificate:|Error adding certificate|Failed to (?:load|parse) TLS key pair from ACME certificate|domains validation)/u.test(
        message,
      ) === false
    ) {
      continue;
    }

    const fields = new Map(
      Array.from(line.matchAll(/\s(\w+)=("(?:[^"\\]|\\.)*"|\[[^\]]*\]|[^\s"]+)/gu), (field) => [
        field[1],
        field[2],
      ]),
    );
    const renewalName = message.match(
      /^Error renewing ACME certificate: \{([a-z0-9.-]+) \[\]\}$/iu,
    )?.[1];
    const names = (fields.get("domains") ?? fields.get("domain") ?? renewalName)?.match(
      /[a-z0-9.*-]+/giu,
    );
    if (names?.length !== 1 || names[0].toLowerCase() !== hostname) {
      continue;
    }

    const error = fields.get("error") ?? "";
    const reason = certificateReason(error);
    const retryAt = reason === "rate-limit" ? certificateRetryAt(error) : null;
    const parsed = entrySchema.safeParse({
      time: timestamp,
      reason,
      ...(retryAt == null ? {} : { retryAt }),
    });
    if (parsed.success) {
      entries.push(parsed.data);
    }
  }

  return entries
    .toSorted((left, right) => Date.parse(right.time) - Date.parse(left.time))
    .slice(0, MAX_ERRORS);
}

function certificateRetryAt(error: string): string | null {
  const deadline = error.match(/retry after (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC\b/iu);
  const [date, time] = [deadline?.[1], deadline?.[2]];
  if (date == null || time == null) {
    return null;
  }

  const parsed = z.iso.datetime().safeParse(`${date}T${time}Z`);
  return parsed.success ? parsed.data : null;
}

/** Limits history to the current deployment and at most one day. */
export function proxyLogsSince(deploymentStartedAt: string, now: Date): string {
  const cutoff = now.getTime() - PROXY_LOG_TTL_IN_MS;
  const startedAt = Date.parse(deploymentStartedAt);
  if (Number.isFinite(startedAt) && startedAt > cutoff && startedAt <= now.getTime()) {
    return new Date(startedAt).toISOString();
  }

  return new Date(cutoff).toISOString();
}

function certificateReason(line: string): Entry["reason"] {
  if (/ratelimit|rate limit|too many certificates|too many failed authorizations/iu.test(line)) {
    return "rate-limit";
  }

  if (/nxdomain|servfail|dns problem|no valid (?:a|aaaa) records/iu.test(line)) {
    return "dns";
  }

  if (/timeout|timed out|deadline exceeded/iu.test(line)) {
    return "timeout";
  }

  if (/connection refused|connection reset/iu.test(line)) {
    return "connection";
  }

  return /unauthorized|invalid response|challenge failed/iu.test(line) ? "challenge" : "other";
}

/** Coalesces concurrent reads and retires expired snapshots on subsequent requests. */
export function requestProxyCertificateLogs(
  database: Database,
  target: ProxyLogTarget,
  now: Date = new Date(),
): string {
  const dedupeKey = `proxy-certificate-logs:${target.projectId}:${target.deploymentId}:${target.hostname}`;
  return database.transaction(
    (transaction) => {
      transaction
        .delete(tables.jobs)
        .where(
          and(
            eq(tables.jobs.projectId, target.projectId),
            eq(tables.jobs.kind, "proxy_certificate_logs"),
            lt(
              tables.jobs.createdAt,
              new Date(now.getTime() - SNAPSHOT_LIFETIME_IN_MS).toISOString(),
            ),
            inArray(tables.jobs.status, ["queued", "succeeded", "failed", "cancelled"]),
          ),
        )
        .run();
      const existing = transaction
        .select({ id: tables.jobs.id })
        .from(tables.jobs)
        .where(
          and(
            eq(tables.jobs.dedupeKey, dedupeKey),
            gte(
              tables.jobs.createdAt,
              new Date(now.getTime() - REFRESH_COOLDOWN_IN_MS).toISOString(),
            ),
          ),
        )
        .orderBy(desc(tables.jobs.createdAt), desc(tables.jobs.id))
        .get();

      return (
        existing?.id ??
        enqueueJob(
          transaction,
          {
            kind: "proxy_certificate_logs",
            projectId: target.projectId,
            deploymentId: target.deploymentId,
            payload: { hostname: target.hostname },
            dedupeKey,
          },
          now,
        ).id
      );
    },
    { behavior: "immediate" },
  );
}

/** Stores only the normalized errors and only while this worker owns the job. */
export function storeProxyCertificateLogs(
  database: Database,
  job: Job,
  entries: readonly Entry[],
): void {
  database.transaction(
    (transaction) => {
      assertJobOwnership(database, job);
      transaction
        .update(tables.jobs)
        .set({ payload: { ...job.payload, entries } })
        .where(eq(tables.jobs.id, job.id))
        .run();
    },
    { behavior: "immediate" },
  );
}

/** Returns results only for the requested project, release, and exact hostname. */
export function readProxyCertificateLogs(
  database: Database,
  target: ProxyLogTarget & { readonly requestId: string },
  now: Date = new Date(),
) {
  const job = database
    .select({ status: tables.jobs.status, payload: tables.jobs.payload })
    .from(tables.jobs)
    .where(
      and(
        eq(tables.jobs.id, target.requestId),
        eq(tables.jobs.kind, "proxy_certificate_logs"),
        eq(tables.jobs.projectId, target.projectId),
        eq(tables.jobs.deploymentId, target.deploymentId),
        gte(tables.jobs.createdAt, new Date(now.getTime() - SNAPSHOT_LIFETIME_IN_MS).toISOString()),
      ),
    )
    .get();
  if (job == null || job.payload["hostname"] !== target.hostname) {
    return { status: "unavailable" } as const;
  }

  if (job.status === "queued" || job.status === "running") {
    return { status: job.status } as const;
  }

  if (job.status === "succeeded") {
    const parsed = entriesSchema.safeParse(job.payload["entries"]);
    if (parsed.success) {
      return { status: "ready", entries: parsed.data } as const;
    }
  }

  return { status: "failed" } as const;
}
