import { z } from "zod";

import { domainInputSchema } from "@/shared/schemas/domain.schema";

const MAX_ADDRESS_LENGTH = 4096;

/** Extracts a domain and explicit HTTP scheme from an address without accepting credentials or custom ports. */
export function parseDomainAddress(
  value: string,
): { readonly hostname: string; readonly httpsEnabled: boolean | null } | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_ADDRESS_LENGTH || /[\r\n\0]/.test(trimmed)) {
    return null;
  }
  const hostname = domainInputSchema.shape.hostname.safeParse(trimmed);
  if (hostname.success) {
    return { hostname: hostname.data, httpsEnabled: null };
  }
  if (URL.canParse(trimmed) === false) {
    return null;
  }
  const url = new URL(trimmed);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    return null;
  }
  const parsed = domainInputSchema.shape.hostname.safeParse(url.hostname);
  if (parsed.success === false) {
    return null;
  }
  return { hostname: parsed.data, httpsEnabled: url.protocol === "https:" };
}

export const domainAddressSchema = domainInputSchema.extend({
  hostname: z
    .string()
    .max(MAX_ADDRESS_LENGTH, "Endereço muito longo")
    .transform((value) => parseDomainAddress(value)?.hostname ?? value)
    .pipe(domainInputSchema.shape.hostname),
});
