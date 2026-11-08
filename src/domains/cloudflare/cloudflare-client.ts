import Cloudflare from "cloudflare";
import { z } from "zod";

import { CloudflareApiError } from "../domain.errors";

const REQUEST_TIMEOUT_IN_MS = 10_000;
const MIN_HTTP_STATUS = 100;
const MAX_HTTP_STATUS = 599;
const httpStatusSchema = z.number().int().min(MIN_HTTP_STATUS).max(MAX_HTTP_STATUS);
const envelopeSchema = z.object({ success: z.literal(true), result: z.unknown() });

/** Configures SDK transport while retaining runtime validation of provider envelopes. */
export function createCloudflareClient(baseUrl: string, token: string): Cloudflare {
  return new Cloudflare({
    baseURL: baseUrl,
    apiToken: token,
    timeout: REQUEST_TIMEOUT_IN_MS,
    fetch: async (url, options) => {
      const response = await fetch(url, options);
      if (response.ok) {
        const answer: unknown = await response.clone().json();
        if (envelopeSchema.safeParse(answer).success === false) {
          throw new CloudflareApiError(response.status);
        }
      }
      return response;
    },
  });
}

/** Keeps SDK errors and their response bodies out of application logs and public errors. */
export function cloudflareFailure(error: unknown): CloudflareApiError {
  if (error instanceof CloudflareApiError) {
    return error;
  }
  const status: unknown = error instanceof Cloudflare.APIError ? error.status : null;
  const parsed = httpStatusSchema.safeParse(status);
  return new CloudflareApiError(parsed.success ? parsed.data : null);
}
