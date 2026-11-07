import { z } from "zod";

import { projectInputSchema } from "../project.schema";

// Each page validates its fields; the merged project is validated before it is saved.
const projectFieldsSchema = z.object(projectInputSchema.shape);

/** Each page accepts only the fields it owns; unrelated submitted fields are stripped. */
export const projectSettingsChangeSchema = z.discriminatedUnion("section", [
  z.object({
    section: z.literal("identity"),
    project: projectFieldsSchema.pick({ name: true, slug: true }),
  }),
  z.object({
    section: z.literal("repository"),
    project: projectFieldsSchema.pick({ repositoryUrl: true, branch: true }),
  }),
  z.object({
    section: z.literal("build"),
    project: projectFieldsSchema.pick({ dockerfilePath: true, buildContext: true }).extend({
      builder: projectInputSchema.shape.builder.removeDefault().optional(),
      composeFilePath: projectInputSchema.shape.composeFilePath.removeDefault().optional(),
      composeService: projectInputSchema.shape.composeService.removeDefault().optional(),
    }),
  }),
  z.object({
    section: z.literal("runtime"),
    project: projectFieldsSchema
      .pick({
        internalPort: true,
        healthCheckPath: true,
        memoryLimitInMb: true,
        cpuLimitInMillicores: true,
      })
      .extend({ replicas: projectInputSchema.shape.replicas.removeDefault().optional() }),
  }),
  z.object({
    section: z.literal("automation"),
    project: projectFieldsSchema
      .pick({
        autoDeploy: true,
        autoApplyChanges: true,
        previewsEnabled: true,
      })
      .extend({ autoRollback: projectInputSchema.shape.autoRollback.removeDefault().optional() }),
  }),
]);

export type ProjectSettingsChange = z.output<typeof projectSettingsChangeSchema>;
export type ProjectSettingsFormSection = ProjectSettingsChange["section"];
