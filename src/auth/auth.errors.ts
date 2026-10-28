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

/** Thrown when a user operation breaks an account rule, such as removing the last admin. */
export class UserOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserOperationError";
  }
}
