import { z } from "zod";

const MAX_HOSTNAME_LENGTH = 253;
const hostnameSchema = z
  .hostname()
  .max(MAX_HOSTNAME_LENGTH)
  .refine(
    (hostname) =>
      hostname.includes(".") &&
      hostname.endsWith(".") === false &&
      hostname === hostname.toLowerCase(),
  );

/**
 * Tells whether a hostname is a fully qualified DNS name.
 *
 * @param hostname - Lowercase hostname without scheme or port.
 * @returns True when every label is valid and there are at least two labels.
 */
export function isValidHostname(hostname: string): boolean {
  return hostnameSchema.safeParse(hostname).success;
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
