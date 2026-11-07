import type { z } from "zod";

import type { firstAdminSchema } from "@/shared/schemas/user.schema";

type FirstAdminAccount = z.output<typeof firstAdminSchema>;

/**
 * Creates the first account once, then attempts sign-in as a separate recoverable step.
 * A sign-in failure must never make the interface offer to create the account again.
 */
export async function finishFirstAdminSetup(
  account: FirstAdminAccount,
  operations: {
    readonly createAccount: (account: FirstAdminAccount) => Promise<unknown>;
    readonly signIn: (account: FirstAdminAccount) => Promise<{ readonly error: unknown }>;
  },
): Promise<"signed-in" | "created"> {
  await operations.createAccount(account);
  try {
    const result = await operations.signIn(account);
    return result.error == null ? "signed-in" : "created";
  } catch {
    return "created";
  }
}
