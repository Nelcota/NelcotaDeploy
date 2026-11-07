import type { V4PagePaginationArray } from "cloudflare/core/pagination";
import type { RecordBatchParams } from "cloudflare/resources/dns/records";
import { z } from "zod";

import { isValidHostname } from "@/shared/schemas/domain.schema";

import { CloudflareApiError, DnsConfigurationError } from "../domain.errors";
import { cloudflareFailure, createCloudflareClient } from "./cloudflare-client";

const PAGE_SIZE = 50;
const MAX_ZONE_PAGES = 20;
const MAX_RECORD_PAGES = 4;
const MAX_RECORD_CONTENT_LENGTH = 65_536;
const MAX_TTL_IN_SECONDS = 86_400;
const identifier = z.string().regex(/^[a-f0-9]{32}$/);
const hostname = z.string().toLowerCase().refine(isValidHostname);
const zoneSchema = z.object({ id: identifier, name: hostname, status: z.string() });
const recordSchema = z.object({
  id: identifier,
  name: hostname,
  type: z.string().min(1).max(16),
  content: z.string().max(MAX_RECORD_CONTENT_LENGTH),
  ttl: z.number().int().min(1).max(MAX_TTL_IN_SECONDS),
  proxied: z.boolean().optional().default(false),
  modified_on: z.string().max(64).optional(),
});
const paginationSchema = z.object({ total_pages: z.number().int().nonnegative().optional() });

export type CloudflareApi = { readonly baseUrl: string };
export const CLOUDFLARE_API: CloudflareApi = { baseUrl: "https://api.cloudflare.com/client/v4" };
export type CloudflareZone = z.infer<typeof zoneSchema>;
export type CloudflareRecord = z.infer<typeof recordSchema>;
export type CloudflareBatch = Pick<RecordBatchParams, "deletes" | "patches" | "posts">;

async function readPages<T>({
  first,
  schema,
  pageNumber,
  maxPages,
}: {
  readonly first: V4PagePaginationArray<unknown>;
  readonly schema: z.ZodType<T>;
  readonly pageNumber: number;
  readonly maxPages: number;
}): Promise<T[]> {
  let page = first;
  let currentPage = pageNumber;
  const result: T[] = [];
  for (;;) {
    const rows = z.array(schema).max(PAGE_SIZE).safeParse(page.result);
    const resultInfo: unknown = page.result_info;
    const metadata = paginationSchema.safeParse(resultInfo ?? {});
    if (rows.success === false || metadata.success === false) {
      throw new CloudflareApiError(null);
    }
    result.push(...rows.data);
    const totalPages = metadata.data.total_pages;
    if (rows.data.length < PAGE_SIZE || (totalPages != null && currentPage >= totalPages)) {
      return result;
    }
    if (currentPage >= maxPages) {
      throw new DnsConfigurationError("too-many-records");
    }
    page = await page.getNextPage().catch((error: unknown) => {
      throw cloudflareFailure(error);
    });
    currentPage += 1;
  }
}

/** Lists every accessible active zone, bounded so a large account never produces partial plans. */
export async function listCloudflareZones(
  api: CloudflareApi,
  token: string,
  page = 1,
): Promise<CloudflareZone[]> {
  if (Number.isSafeInteger(page) === false || page < 1 || page > MAX_ZONE_PAGES) {
    throw new DnsConfigurationError("too-many-records");
  }
  const first = await createCloudflareClient(api.baseUrl, token)
    .zones.list({
      status: "active",
      per_page: PAGE_SIZE,
      page,
    })
    .catch((error: unknown) => {
      throw cloudflareFailure(error);
    });
  const zones = await readPages({
    first,
    schema: zoneSchema,
    pageNumber: page,
    maxPages: MAX_ZONE_PAGES,
  });
  return zones.filter((zone) => zone.status === "active");
}

/** Reads only records at the exact project hostname, preserving other names and record types. */
export async function listCloudflareRecords(
  api: CloudflareApi,
  input: {
    readonly token: string;
    readonly zoneId: string;
    readonly hostname: string;
    readonly page?: number;
  },
): Promise<CloudflareRecord[]> {
  const page = input.page ?? 1;
  if (Number.isSafeInteger(page) === false || page < 1 || page > MAX_RECORD_PAGES) {
    throw new DnsConfigurationError("too-many-records");
  }
  const first = await createCloudflareClient(api.baseUrl, input.token)
    .dns.records.list({
      zone_id: input.zoneId,
      name: { exact: input.hostname },
      per_page: PAGE_SIZE,
      page,
    })
    .catch((error: unknown) => {
      throw cloudflareFailure(error);
    });
  const records = await readPages({
    first,
    schema: recordSchema,
    pageNumber: page,
    maxPages: MAX_RECORD_PAGES,
  });
  if (records.some((record) => record.name !== input.hostname)) {
    throw new CloudflareApiError(null);
  }
  return records;
}

/** Applies the reviewed changes in one provider batch; DNS propagation remains asynchronous. */
export async function batchCloudflareRecords(
  api: CloudflareApi,
  input: {
    readonly token: string;
    readonly zoneId: string;
    readonly body: CloudflareBatch;
  },
): Promise<void> {
  // A retried POST could apply a reviewed creation twice after an ambiguous network failure.
  await createCloudflareClient(api.baseUrl, input.token)
    .dns.records.batch(
      {
        ...input.body,
        zone_id: input.zoneId,
      },
      { maxRetries: 0 },
    )
    .catch((error: unknown) => {
      throw cloudflareFailure(error);
    });
}
