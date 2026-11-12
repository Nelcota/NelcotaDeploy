import type { Database } from "@/db";

import type { Auth } from "./auth";
import { SetupAlreadyDoneError, UserOperationError } from "./auth.errors";
import { createUser, hasAdmin } from "./user.service";

/**
 * Tells whether the panel still needs its first admin, which the login page then creates.
 *
 * @param database - Database.
 * @param publicSetupDisabled - Whether provisioning is restricted to the CLI.
 * @returns True while no admin exists.
 */
export function needsFirstAdmin(database: Database, publicSetupDisabled = false): boolean {
  return publicSetupDisabled === false && hasAdmin(database) === false;
}

/**
 * Creates the first admin from the login page of a fresh panel. Once an admin exists, this
 * always refuses, so the page cannot be used to add accounts later.
 *
 * @param auth - Auth instance that stores the account.
 * @param database - Database.
 * @param account - The administrator credentials and whether provisioning is restricted to the CLI.
 * @returns The new user id.
 * @throws {SetupAlreadyDoneError} When an admin already exists.
 * @throws {UserOperationError} When public setup is disabled or the password is too short.
 */
export async function createFirstAdmin(
  auth: Auth,
  database: Database,
  {
    publicSetupDisabled = false,
    ...account
  }: {
    readonly name: string;
    readonly email: string;
    readonly password: string;
    readonly publicSetupDisabled?: boolean;
  },
): Promise<string> {
  if (publicSetupDisabled) {
    throw new UserOperationError("public-setup-disabled");
  }

  if (needsFirstAdmin(database) === false) {
    throw new SetupAlreadyDoneError();
  }
  return await createUser(auth, database, {
    newUser: { ...account, role: "admin" },
    firstAdmin: true,
    actor: { type: "system", label: "first-run setup" },
  });
}
