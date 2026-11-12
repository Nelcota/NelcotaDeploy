import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";

import { createAuth } from "./auth";
import { UserOperationError } from "./auth.errors";
import { createUser, resetUserPassword, setUserDisabled, updateUserRole } from "./user.service";

function setup() {
  const database = openMemoryDatabase();
  const auth = createAuth(database, {
    secret: "test-secret-with-enough-length-0123456789",
    baseURL: "http://localhost:3000",
  });
  return { auth, database };
}

describe("user.service rules", () => {
  test("rejects weak password on createUser and resetUserPassword", async () => {
    const { auth, database } = setup();
    using _connection = database.$client;
    const actor = { type: "user", id: "admin-1", label: "Admin" } as const;

    const createError = await createUser(auth, database, {
      newUser: { email: "a@example.com", name: "Ana", role: "admin", password: "short" },
      actor,
    }).catch((error: unknown) => error);
    const resetError = await resetUserPassword(auth, database, {
      userId: "admin-1",
      password: "short",
      actor,
    }).catch((error: unknown) => error);

    expect(createError).toBeInstanceOf(UserOperationError);
    expect((createError as UserOperationError).reason).toBe("weak-password");
    expect(resetError).toBeInstanceOf(UserOperationError);
    expect((resetError as UserOperationError).reason).toBe("weak-password");
  });

  test("rejects duplicate email", async () => {
    const { auth, database } = setup();
    using _connection = database.$client;
    const actor = { type: "user", id: "admin-1", label: "Admin" } as const;
    const newUser = {
      email: "ana@example.com",
      name: "Ana",
      role: "admin" as const,
      password: "a-long-password-1",
    };
    await createUser(auth, database, { newUser, actor });

    const duplicate = await createUser(auth, database, { newUser, actor }).catch(
      (error: unknown) => error,
    );

    expect(duplicate).toBeInstanceOf(UserOperationError);
    expect((duplicate as UserOperationError).reason).toBe("email-taken");
  });

  test("prevents users from changing their own role or disabling their own account", async () => {
    const { auth, database } = setup();
    using _connection = database.$client;
    const systemActor = { type: "system", label: "seed" } as const;
    const userId = await createUser(auth, database, {
      newUser: {
        email: "ana@example.com",
        name: "Ana",
        role: "admin",
        password: "a-long-password-1",
      },
      actor: systemActor,
    });
    const selfActor = { type: "user", id: userId, label: "Ana" } as const;

    expect(() => updateUserRole(database, { userId, role: "developer", actor: selfActor })).toThrow(
      UserOperationError,
    );
    expect(() => setUserDisabled(database, { userId, disabled: true, actor: selfActor })).toThrow(
      UserOperationError,
    );
  });

  test("prevents removing or disabling the last active admin", async () => {
    const { auth, database } = setup();
    using _connection = database.$client;
    const systemActor = { type: "system", label: "seed" } as const;
    const adminId = await createUser(auth, database, {
      newUser: {
        email: "ana@example.com",
        name: "Ana",
        role: "admin",
        password: "a-long-password-1",
      },
      actor: systemActor,
    });
    const otherActor = { type: "user", id: "other", label: "Other" } as const;

    expect(() =>
      updateUserRole(database, { userId: adminId, role: "developer", actor: otherActor }),
    ).toThrow(UserOperationError);
    expect(() =>
      setUserDisabled(database, { userId: adminId, disabled: true, actor: otherActor }),
    ).toThrow(UserOperationError);
  });
});
