import { expect, test } from "bun:test";

import { finishFirstAdminSetup } from "./first-admin-setup";

const account = { name: "Ana", email: "ana@example.com", password: "a-valid-test-password" };

test("creates the account before attempting sign-in", async () => {
  const calls: string[] = [];
  const result = await finishFirstAdminSetup(account, {
    createAccount: () => {
      calls.push("create");
      return Promise.resolve();
    },
    signIn: () => {
      calls.push("sign-in");
      return Promise.resolve({ error: null });
    },
  });

  expect(result).toBe("signed-in");
  expect(calls).toEqual(["create", "sign-in"]);
});

test("preserves the successful account creation when sign-in is refused", async () => {
  let creations = 0;
  const result = await finishFirstAdminSetup(account, {
    createAccount: () => {
      creations += 1;
      return Promise.resolve();
    },
    signIn: () => Promise.resolve({ error: { status: 503 } }),
  });

  expect(result).toBe("created");
  expect(creations).toBe(1);
});

test("offers login recovery after a network error without retrying account creation", async () => {
  let creations = 0;
  const result = await finishFirstAdminSetup(account, {
    createAccount: () => {
      creations += 1;
      return Promise.resolve();
    },
    signIn: () => Promise.reject(new TypeError("Failed to fetch")),
  });

  expect(result).toBe("created");
  expect(creations).toBe(1);
});

test("never signs in when account creation fails", async () => {
  const failure = new Error("Creation refused");
  let signIns = 0;
  const result: unknown = await finishFirstAdminSetup(account, {
    createAccount: () => Promise.reject(failure),
    signIn: () => {
      signIns += 1;
      return Promise.resolve({ error: null });
    },
  }).catch((error: unknown) => error);

  expect(result).toBe(failure);
  expect(signIns).toBe(0);
});
