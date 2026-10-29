/** Thrown when the MCP token is invalid, revoked, expired or lacks a scope. */
export class McpAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpAuthorizationError";
  }
}
