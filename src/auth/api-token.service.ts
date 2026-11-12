import { and, desc, eq, isNull } from "drizzle-orm";

import { type Actor, recordAuditEvent } from "@/audit";
import { type Database, tables } from "@/db";

/** Scopes an API token can carry. "deploy" changes infrastructure; "read" only reads. */
export type ApiTokenScope = "read" | "deploy";

const TOKEN_PREFIX = "nct_";
const TOKEN_RANDOM_BYTES = 32;

/** An API token that passed verification. */
export type VerifiedApiToken = {
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly ApiTokenScope[];
};

function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

/**
 * Creates an API token. The plaintext is returned once and only its hash is stored.
 *
 * @param database - Database.
 * @param input - Token name, scopes and optional expiry (UTC ISO).
 * @param actor - Who creates the token.
 * @returns The token id and plaintext value.
 */
export function createApiToken(
  database: Database,
  input: {
    readonly name: string;
    readonly scopes: readonly ApiTokenScope[];
    readonly expiresAt: string | null;
    readonly createdByUserId: string | null;
  },
  actor: Actor,
): { id: string; token: string } {
  const token = `${TOKEN_PREFIX}${Buffer.from(crypto.getRandomValues(new Uint8Array(TOKEN_RANDOM_BYTES))).toString("base64url")}`;
  const id = Bun.randomUUIDv7();
  database.transaction(
    (transaction) => {
      transaction
        .insert(tables.apiTokens)
        .values({
          id,
          name: input.name,
          tokenHash: hashToken(token),
          scopes: [...new Set(input.scopes)],
          createdByUserId: input.createdByUserId,
          expiresAt: input.expiresAt,
          createdAt: new Date().toISOString(),
        })
        .run();
      recordAuditEvent(transaction, {
        actor,
        action: "api_token.create",
        targetType: "api_token",
        targetId: id,
        metadata: { name: input.name, scopes: input.scopes },
      });
    },
    { behavior: "immediate" },
  );
  return { id, token };
}

/**
 * Verifies a plaintext token.
 *
 * @param database - Database.
 * @param token - Token presented by a client.
 * @param now - Current time, injectable for tests.
 * @returns The token, or null when it is unknown, revoked or expired.
 */
export function verifyApiToken(
  database: Database,
  token: string,
  now?: Date,
): VerifiedApiToken | null {
  if (token.startsWith(TOKEN_PREFIX) === false) {
    return null;
  }
  const tokenHash = hashToken(token);
  return database.transaction(
    (transaction) => {
      const verifiedAt = now ?? new Date();
      const nowInMs = verifiedAt.getTime();
      if (Number.isFinite(nowInMs) === false) {
        return null;
      }

      const row = transaction
        .select({
          id: tables.apiTokens.id,
          name: tables.apiTokens.name,
          scopes: tables.apiTokens.scopes,
          expiresAt: tables.apiTokens.expiresAt,
        })
        .from(tables.apiTokens)
        .where(and(eq(tables.apiTokens.tokenHash, tokenHash), isNull(tables.apiTokens.revokedAt)))
        .get();
      if (row == null) {
        return null;
      }

      const { expiresAt, ...verified } = row;
      if (expiresAt != null) {
        const expiryInMs = Date.parse(expiresAt);
        if (Number.isFinite(expiryInMs) === false || expiryInMs <= nowInMs) {
          return null;
        }
      }

      transaction
        .update(tables.apiTokens)
        .set({ lastUsedAt: verifiedAt.toISOString() })
        .where(eq(tables.apiTokens.id, verified.id))
        .run();
      return verified;
    },
    { behavior: "immediate" },
  );
}

/**
 * Lists API tokens without their hashes, newest first.
 *
 * @param database - Database.
 * @returns Token metadata.
 */
export function listApiTokens(database: Database) {
  return database
    .select({
      id: tables.apiTokens.id,
      name: tables.apiTokens.name,
      scopes: tables.apiTokens.scopes,
      lastUsedAt: tables.apiTokens.lastUsedAt,
      expiresAt: tables.apiTokens.expiresAt,
      revokedAt: tables.apiTokens.revokedAt,
      createdAt: tables.apiTokens.createdAt,
    })
    .from(tables.apiTokens)
    .orderBy(desc(tables.apiTokens.createdAt))
    .all();
}

/**
 * Revokes a token so it stops working immediately.
 *
 * @param database - Database.
 * @param tokenId - Token to revoke.
 * @param actor - Who revokes it.
 */
export function revokeApiToken(database: Database, tokenId: string, actor: Actor): void {
  database.transaction(
    (transaction) => {
      transaction
        .update(tables.apiTokens)
        .set({ revokedAt: new Date().toISOString() })
        .where(and(eq(tables.apiTokens.id, tokenId), isNull(tables.apiTokens.revokedAt)))
        .run();
      recordAuditEvent(transaction, {
        actor,
        action: "api_token.revoke",
        targetType: "api_token",
        targetId: tokenId,
      });
    },
    { behavior: "immediate" },
  );
}
