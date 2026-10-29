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
  /** Discord or Slack incoming webhook that hears about failed deploys and servers going down. */
  alertWebhookUrl: z
    .string()
    .trim()
    .refine((value) => value === "" || isWebhookUrl(value), {
      message: "Informe uma URL https://, como a de um webhook do Discord ou do Slack",
    })
    .transform((value) => (value === "" ? null : value)),
});

const MAX_URL_LENGTH = 2000;

function isWebhookUrl(value: string): boolean {
  if (value.length > MAX_URL_LENGTH || URL.canParse(value) === false) {
    return false;
  }
  const protocol = new URL(value).protocol;
  return protocol === "https:" || protocol === "http:";
}

export type SystemSettings = z.output<typeof systemSettingsSchema>;

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  organizationName: "Minha organização",
  baseDomain: null,
  httpsByDefault: true,
  alertWebhookUrl: null,
};
