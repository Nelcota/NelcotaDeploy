import { z } from "zod";

import { isValidHostname } from "./domain.schema";

const MAX_ORGANIZATION_NAME_LENGTH = 80;

/** Organization-wide preferences editable by admins. */
export const systemSettingsSchema = z.object({
  organizationName: z
    .string()
    .transform((value) => value.normalize("NFC").trim())
    .pipe(z.string().min(1, "Campo obrigatório").max(MAX_ORGANIZATION_NAME_LENGTH)),
  /** When set, every project is reachable at "<slug>.<baseDomain>" without manual setup. */
  baseDomain: z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => value === "" || isValidHostname(value), {
      message: "Informe um domínio válido, como apps.exemplo.com",
    })
    .transform((value) => (value === "" ? null : value)),
  httpsByDefault: z.boolean(),
});

export type SystemSettings = z.output<typeof systemSettingsSchema>;

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  organizationName: "Minha organização",
  baseDomain: null,
  httpsByDefault: true,
};
