import type { Database } from "@/db";

import type { Auth } from "./auth";
import { SetupAlreadyDoneError } from "./auth.errors";
import { createUser, hasAdmin } from "./user.service";

/**
 * Tells whether the panel still needs its first admin, which the login page then creates.
 *
 * @param database - Database.
 * @returns True while no admin exists.
 */
export function needsFirstAdmin(database: Database): boolean {
  return hasAdmin(database) === false;
}

/**
 * Creates the first admin from the login page of a fresh panel. Once an admin exists, this
 * always refuses, so the page cannot be used to add accounts later.
 *
 * @param auth - Auth instance that stores the account.
 * @param database - Database.
 * @param account - Name, e-mail and password of the admin.
 * @returns The new user id.
 * @throws {SetupAlreadyDoneError} When an admin already exists.
 * @throws {UserOperationError} When the password is too short.
 */
export async function createFirstAdmin(
  auth: Auth,
  database: Database,
  account: { readonly name: string; readonly email: string; readonly password: string },
): Promise<string> {
  if (needsFirstAdmin(database) === false) {
    throw new SetupAlreadyDoneError();
  }
  return await createUser(auth, database, {
    newUser: { ...account, role: "admin" },
    actor: { type: "system", label: "first-run setup" },
  });
}
