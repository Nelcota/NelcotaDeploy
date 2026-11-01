import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openMemoryDatabase, tables } from "@/db";

import { createAuth } from "./auth";
import { SetupAlreadyDoneError } from "./auth.errors";
import { createFirstAdmin, needsFirstAdmin } from "./first-admin.service";

const ADMIN = { name: "Ana", email: "Ana@Example.com", password: "a-long-password-1" };

function setup() {
  const database = openMemoryDatabase();
  const auth = createAuth(database, {
    secret: "test-secret-with-enough-length-0123456789",
    baseURL: "http://localhost:3000",
  });
  return { auth, database };
}

describe("createFirstAdmin", () => {
  test("admits exactly one admin when first-run requests race", async () => {
    const { auth, database } = setup();

    const results = await Promise.allSettled([
      createFirstAdmin(auth, database, ADMIN),
      createFirstAdmin(auth, database, { ...ADMIN, email: "second@example.com" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(SetupAlreadyDoneError);
    expect(database.select({ id: tables.users.id }).from(tables.users).all()).toHaveLength(1);
    expect(database.select({ id: tables.accounts.id }).from(tables.accounts).all()).toHaveLength(1);
    database.$client.close();
  });

  test("creates credentials accepted by Better Auth", async () => {
    const { auth, database } = setup();
    await createFirstAdmin(auth, database, ADMIN);

    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ email: ADMIN.email.toLowerCase(), password: ADMIN.password }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    database.$client.close();
  });
  test("creates an admin while the panel has none", async () => {
    const { auth, database } = setup();

    const id = await createFirstAdmin(auth, database, ADMIN);

    const user = database
      .select({ role: tables.users.role, email: tables.users.email })
      .from(tables.users)
      .where(eq(tables.users.id, id))
      .get();
    expect(user).toEqual({ role: "admin", email: "ana@example.com" });
    expect(needsFirstAdmin(database)).toBe(false);
  });

  test("throws SetupAlreadyDoneError once an admin exists", async () => {
    const { auth, database } = setup();
    await createFirstAdmin(auth, database, ADMIN);

    const second = createFirstAdmin(auth, database, { ...ADMIN, email: "eve@example.com" });

    expect(await second.catch((error: unknown) => error)).toBeInstanceOf(SetupAlreadyDoneError);
  });
});

describe("needsFirstAdmin", () => {
  test("is true on a fresh database", () => {
    expect(needsFirstAdmin(openMemoryDatabase())).toBe(true);
  });
});
