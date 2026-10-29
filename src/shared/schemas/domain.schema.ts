import { z } from "zod";

const MAX_HOSTNAME_LENGTH = 253;
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Tells whether a hostname is a fully qualified DNS name.
 *
 * @param hostname - Lowercase hostname without scheme or port.
 * @returns True when every label is valid and there are at least two labels.
 */
export function isValidHostname(hostname: string): boolean {
  if (hostname.length === 0 || hostname.length > MAX_HOSTNAME_LENGTH) {
    return false;
  }
  const labels = hostname.split(".");
  if (labels.length < 2) {
    return false;
  }
  return labels.every((label) => LABEL_PATTERN.test(label));
}

export const domainInputSchema = z.object({
  hostname: z
    .string()
    .trim()
    .toLowerCase()
    .refine(isValidHostname, { message: "Informe um domínio válido, como app.exemplo.com" }),
  httpsEnabled: z.boolean(),
});

export type DomainInput = z.infer<typeof domainInputSchema>;
