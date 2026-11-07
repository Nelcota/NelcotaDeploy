import { z } from "zod";

import { systemSettingsSchema } from "../settings.schema";

/** Isolates organization identity, automatic addresses and alert delivery preferences. */
export const organizationSettingsChangeSchema = z.discriminatedUnion("section", [
  z.object({
    section: z.literal("organization"),
    settings: systemSettingsSchema.pick({ organizationName: true }).extend({
      requireAdminTwoFactor: z.boolean().optional(),
    }),
  }),
  z.object({
    section: z.literal("domains"),
    settings: systemSettingsSchema.pick({ baseDomain: true, httpsByDefault: true }),
  }),
  z.object({
    section: z.literal("alerts"),
    settings: systemSettingsSchema.pick({ alertWebhookUrl: true }),
  }),
]);

export type OrganizationSettingsChange = z.output<typeof organizationSettingsChangeSchema>;
export type OrganizationSettingsSection = OrganizationSettingsChange["section"];
