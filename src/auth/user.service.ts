import { and, asc, eq, ne } from "drizzle-orm";

import { type Actor, recordAuditEvent } from "@/audit";
import { type Database, tables } from "@/db";
import type { Role } from "@/shared/roles";
import { PASSWORD_MIN_LENGTH } from "@/shared/schemas/user.schema";

import type { Auth } from "./auth";
import { UserOperationError } from "./auth.errors";

const CREDENTIAL_PROVIDER_ID = "credential";

/** Fields needed to create an account. */
export type NewUser = {
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly password: string;
};

/**
 * Lists every user, oldest first.
 *
 * @param database - Database.
 * @returns Users without credentials.
 */
export function listUsers(database: Database) {
  return database
    .select({
      id: tables.users.id,
      name: tables.users.name,
      email: tables.users.email,
      role: tables.users.role,
      disabled: tables.users.disabled,
      image: tables.users.image,
      createdAt: tables.users.createdAt,
    })
    .from(tables.users)
    .orderBy(asc(tables.users.createdAt))
    .all()
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      disabled: user.disabled,
      image: user.image,
      createdAt: user.createdAt.toISOString(),
    }));
}

/**
 * Tells whether any admin account exists.
 *
 * @param database - Database.
 * @returns True when at least one admin exists.
 */
export function hasAdmin(database: Database): boolean {
  const admin = database
    .select({ id: tables.users.id })
    .from(tables.users)
    .where(eq(tables.users.role, "admin"))
    .get();
  return admin != null;
}

/**
 * Creates an account with an email and password.
 *
 * @param auth - Auth instance whose hasher and adapter store the account.
 * @param database - Database for the duplicate check and audit trail.
 * @param request - `newUser` fields (the email is normalized to lowercase) and the `actor`
 *   creating the account.
 * @returns The new user id.
 * @throws {UserOperationError} When the email is taken or the password is too short.
 */
export async function createUser(
  auth: Auth,
  database: Database,
  { newUser, actor }: { readonly newUser: NewUser; readonly actor: Actor },
): Promise<string> {
  const email = newUser.email.trim().toLowerCase();
  if (newUser.password.length < PASSWORD_MIN_LENGTH) {
    throw new UserOperationError(`Password must have at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  const existing = database
    .select({ id: tables.users.id })
    .from(tables.users)
    .where(eq(tables.users.email, email))
    .get();
  if (existing != null) {
    throw new UserOperationError("Email already in use");
  }
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser(
    {
      email,
      name: newUser.name.trim(),
      emailVerified: true,
      role: newUser.role,
      disabled: false,
    },
    { method: "admin" },
  );
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: CREDENTIAL_PROVIDER_ID,
    accountId: user.id,
    password: await context.password.hash(newUser.password),
  });
  recordAuditEvent(database, {
    actor,
    action: "user.create",
    targetType: "user",
    targetId: user.id,
    metadata: { email, role: newUser.role },
  });
  return user.id;
}

/**
 * Changes a user's role.
 *
 * @param database - Database.
 * @param change - User to change, the new role and who is changing it.
 * @throws {UserOperationError} When the change would leave no active admin.
 */
export function updateUserRole(
  database: Database,
  { userId, role, actor }: { readonly userId: string; readonly role: Role; readonly actor: Actor },
): void {
  database.transaction((transaction) => {
    if (role !== "admin") {
      assertAnotherActiveAdminExists(transaction, userId);
    }
    transaction
      .update(tables.users)
      .set({ role, updatedAt: new Date() })
      .where(eq(tables.users.id, userId))
      .run();
    recordAuditEvent(transaction, {
      actor,
      action: "user.role_update",
      targetType: "user",
      targetId: userId,
      metadata: { role },
    });
  });
}

/**
 * Enables or disables a user. Disabling also ends the user's sessions.
 *
 * @param database - Database.
 * @param change - User to change, `disabled` true to block sign-in, and who is changing it.
 * @throws {UserOperationError} When disabling would leave no active admin.
 */
export function setUserDisabled(
  database: Database,
  {
    userId,
    disabled,
    actor,
  }: { readonly userId: string; readonly disabled: boolean; readonly actor: Actor },
): void {
  database.transaction((transaction) => {
    if (disabled) {
      assertAnotherActiveAdminExists(transaction, userId);
      transaction.delete(tables.sessions).where(eq(tables.sessions.userId, userId)).run();
    }
    transaction
      .update(tables.users)
      .set({ disabled, updatedAt: new Date() })
      .where(eq(tables.users.id, userId))
      .run();
    recordAuditEvent(transaction, {
      actor,
      action: disabled ? "user.disable" : "user.enable",
      targetType: "user",
      targetId: userId,
    });
  });
}

/**
 * Replaces a user's password and ends their sessions.
 *
 * @param auth - Auth instance whose hasher stores the password.
 * @param database - Database for the audit trail.
 * @param change - User whose password changes, the new password and who is changing it.
 * @throws {UserOperationError} When the password is too short.
 */
export async function resetUserPassword(
  auth: Auth,
  database: Database,
  {
    userId,
    password,
    actor,
  }: { readonly userId: string; readonly password: string; readonly actor: Actor },
): Promise<void> {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new UserOperationError(`Password must have at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  const context = await auth.$context;
  await context.internalAdapter.updatePassword(userId, await context.password.hash(password));
  await context.internalAdapter.deleteUserSessions(userId);
  recordAuditEvent(database, {
    actor,
    action: "user.password_reset",
    targetType: "user",
    targetId: userId,
  });
}

function assertAnotherActiveAdminExists(
  database: Pick<Database, "select">,
  excludedUserId: string,
): void {
  const otherAdmin = database
    .select({ id: tables.users.id })
    .from(tables.users)
    .where(
      and(
        eq(tables.users.role, "admin"),
        eq(tables.users.disabled, false),
        ne(tables.users.id, excludedUserId),
      ),
    )
    .get();
  if (otherAdmin == null) {
    throw new UserOperationError("At least one active admin must remain");
  }
}
