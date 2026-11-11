import type { Permission } from "@/shared/roles";

/** Thrown when a request has no valid session or token. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "UnauthenticatedError";
  }
}

/** Thrown when the authenticated user lacks a permission. */
export class ForbiddenError extends Error {
  readonly permission: Permission;

  constructor(permission: Permission) {
    super(`Missing permission ${permission}`);
    this.name = "ForbiddenError";
    this.permission = permission;
  }
}

/** Reason why a user operation could not be completed. */
export type UserOperationReason =
  | "weak-password"
  | "email-taken"
  | "last-admin"
  | "self-role-change"
  | "self-disable";

const USER_OPERATION_MESSAGES: Readonly<Record<UserOperationReason, string>> = {
  "weak-password": "Password does not meet the minimum length requirement",
  "email-taken": "Email already in use",
  "last-admin": "At least one active admin must remain",
  "self-role-change": "Users cannot change their own role",
  "self-disable": "Users cannot disable their own account",
};

/** Thrown when a user operation breaks an account rule, such as removing the last admin. */
export class UserOperationError extends Error {
  readonly reason: UserOperationReason;

  constructor(reason: UserOperationReason) {
    super(USER_OPERATION_MESSAGES[reason]);
    this.name = "UserOperationError";
    this.reason = reason;
  }
}

/** Thrown when a profile photo exceeds the byte/pixel limits or cannot decode as PNG, JPEG or WebP. */
export class InvalidAvatarError extends Error {
  constructor(reason: string) {
    super(`Invalid avatar: ${reason}`);
    this.name = "InvalidAvatarError";
  }
}

/** Thrown when someone tries the first-run setup after an admin already exists. */
export class SetupAlreadyDoneError extends Error {
  constructor() {
    super("The first admin already exists");
    this.name = "SetupAlreadyDoneError";
  }
}

/** Thrown when an admin must turn on two-factor authentication before using the panel. */
export class TwoFactorRequiredError extends Error {
  constructor() {
    super("Two-factor authentication is required for admins");
    this.name = "TwoFactorRequiredError";
  }
}
