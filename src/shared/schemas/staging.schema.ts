import { z } from "zod";

import { isValidBranchName } from "./project.schema";

/** Fields of a new staging environment. */
export const stagingInputSchema = z.object({
  branch: z.string().trim().refine(isValidBranchName, { message: "Nome de branch inválido" }),
  /** Copies production's variables, except the URLs of its managed databases. */
  copyVariables: z.boolean(),
});

export type StagingInput = z.infer<typeof stagingInputSchema>;
