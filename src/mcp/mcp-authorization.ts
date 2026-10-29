import type { Actor } from "@/audit";
import { type ApiTokenScope, verifyApiToken } from "@/auth";
import type { Database } from "@/db";

import { McpAuthorizationError } from "./mcp.errors";

/** Shared state of every tool call. */
export type McpToolContext = {
  readonly database: Database;
  /** Plaintext token from the MCP process environment, re-verified on every call. */
  readonly token: string;
};

/**
 * Re-verifies the MCP token and checks it has a scope.
 *
 * @param context - Database and plaintext token.
 * @param scope - Scope the tool needs.
 * @returns The audit actor for the token.
 * @throws {McpAuthorizationError} When the token is invalid, revoked, expired or lacks the scope.
 */
export function authorize(context: McpToolContext, scope: ApiTokenScope): Actor {
  const token = verifyApiToken(context.database, context.token);
  if (token == null) {
    throw new McpAuthorizationError("The MCP token is invalid, revoked or expired");
  }
  if (token.scopes.includes(scope) === false) {
    throw new McpAuthorizationError(`The MCP token lacks the "${scope}" scope`);
  }
  return { type: "token", id: token.id, label: `token:${token.name}` };
}
