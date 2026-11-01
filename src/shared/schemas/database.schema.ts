import { z } from "zod";

import { isValidEnvironmentVariableKey } from "./environment-variable.schema";

/** Database servers the platform can run for a project. */
export const DATABASE_ENGINES = ["postgres", "redis"] as const;

export type DatabaseEngineName = (typeof DATABASE_ENGINES)[number];

/** Most databases a project can have. */
export const MAX_DATABASES_PER_PROJECT = 5;

export const databaseInputSchema = z.object({
  engine: z.enum(DATABASE_ENGINES),
  /** Variable of the project that receives the connection URL. */
  environmentKey: z.string().trim().refine(isValidEnvironmentVariableKey, {
    message: "Use letras, números e _ (sem começar com número, NELCOTA_ ou DOCKER_)",
  }),
});

export type DatabaseInput = z.infer<typeof databaseInputSchema>;
