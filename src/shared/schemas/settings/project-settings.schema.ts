import { z } from "zod";

import { projectInputSchema } from "../project.schema";

/** Each page accepts only the fields it owns; unrelated submitted fields are stripped. */
export const projectSettingsChangeSchema = z.discriminatedUnion("section", [
  z.object({
    section: z.literal("identity"),
    project: projectInputSchema.pick({ name: true, slug: true }),
  }),
  z.object({
    section: z.literal("repository"),
    project: projectInputSchema.pick({ repositoryUrl: true, branch: true }),
  }),
  z.object({
    section: z.literal("build"),
    project: projectInputSchema.pick({ dockerfilePath: true, buildContext: true }),
  }),
  z.object({
    section: z.literal("runtime"),
    project: projectInputSchema.pick({
      internalPort: true,
      healthCheckPath: true,
      memoryLimitInMb: true,
      cpuLimitInMillicores: true,
    }),
  }),
  z.object({
    section: z.literal("automation"),
    project: projectInputSchema.pick({
      autoDeploy: true,
      autoApplyChanges: true,
      previewsEnabled: true,
    }),
  }),
]);

export type ProjectSettingsChange = z.output<typeof projectSettingsChangeSchema>;
export type ProjectSettingsFormSection = ProjectSettingsChange["section"];
