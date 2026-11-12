import { describe, expect, test } from "bun:test";

import { type Database, openMemoryDatabase } from "@/db";

import { createApiToken, listApiTokens, revokeApiToken, verifyApiToken } from "./api-token.service";

const NOW = new Date("2026-11-12T12:00:00.000Z");
const ACTOR = { type: "system", label: "test" } as const;

function createToken(database: Database, expiresAt: string | null) {
  return createApiToken(
    database,
    { name: "test", scopes: ["read"], expiresAt, createdByUserId: null },
    ACTOR,
  );
}

describe("verifyApiToken", () => {
  test("records the time a valid token was used", () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const { id, token } = createToken(database, "2026-11-12T12:00:00.001Z");

    const verified = verifyApiToken(database, token, NOW);

    expect(verified).toEqual({ id, name: "test", scopes: ["read"] });
    expect(listApiTokens(database)[0]?.lastUsedAt).toBe(NOW.toISOString());
  });

  test.each(["2026-11-12T12:00:00Z", "2026-11-12T12:00:00.000Z", "not a date"])(
    "rejects an expired or invalid stored expiry of %p",
    (expiresAt) => {
      const database = openMemoryDatabase();
      using _connection = database.$client;
      const { token } = createToken(database, expiresAt);

      expect(verifyApiToken(database, token, NOW)).toBeNull();
      expect(listApiTokens(database)[0]?.lastUsedAt).toBeNull();
    },
  );

  test("leaves the last-use time alone after revocation", () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const { id, token } = createToken(database, null);
    revokeApiToken(database, id, ACTOR);

    expect(verifyApiToken(database, token, NOW)).toBeNull();
    expect(listApiTokens(database)[0]?.lastUsedAt).toBeNull();
  });

  test("rejects an invalid verification clock", () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const { token } = createToken(database, null);

    expect(verifyApiToken(database, token, new Date(Number.NaN))).toBeNull();
  });
});
