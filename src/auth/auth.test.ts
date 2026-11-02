import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";

import { configureGitHubLogin, createAuth, isGitHubLoginEnabled, mayOpenSession } from "./auth";

describe("mayOpenSession", () => {
  const active = { disabled: false, twoFactorEnabled: false };

  test("opens a session for an active user", () => {
    expect(mayOpenSession(active, "/sign-in/email")).toBe(true);
  });

  test("refuses a disabled user", () => {
    expect(mayOpenSession({ ...active, disabled: true }, "/sign-in/email")).toBe(false);
  });

  test("refuses a user that no longer exists", () => {
    expect(mayOpenSession(null, "/sign-in/email")).toBe(false);
  });

  test("refuses GitHub sign-in for a user with two-factor authentication", () => {
    const user = { ...active, twoFactorEnabled: true };

    expect(mayOpenSession(user, "/callback/github")).toBe(false);
  });

  test("lets a user with two-factor authentication finish the code step", () => {
    const user = { ...active, twoFactorEnabled: true };

    expect(mayOpenSession(user, "/two-factor/verify-totp")).toBe(true);
  });

  test("lets GitHub sign in a user without two-factor authentication", () => {
    expect(mayOpenSession(active, "/callback/github")).toBe(true);
  });
});

describe("createAuth two-factor", () => {
  test("enables the two-factor plugin", () => {
    const auth = createAuth(openMemoryDatabase(), {
      secret: "test-secret-with-enough-length-0123456789",
      baseURL: "http://localhost:3000",
    });

    expect(auth.options.plugins.map((plugin) => plugin.id)).toContain("two-factor");
  });
});

const OPTIONS = {
  secret: "test-secret-with-enough-length-0123456789",
  baseURL: "http://localhost:3000",
};
const GITHUB = { clientId: "Iv1.abc", clientSecret: "client-secret" };

describe("createAuth GitHub sign-in", () => {
  test("offers GitHub only with an OAuth client", () => {
    const auth = createAuth(openMemoryDatabase(), OPTIONS);

    expect(auth.options.socialProviders).toEqual({});
  });

  test("never lets GitHub create an account", () => {
    const auth = createAuth(openMemoryDatabase(), { ...OPTIONS, github: GITHUB });

    expect(auth.options.socialProviders.github?.disableSignUp).toBe(true);
  });

  test("links a GitHub identity only through a verified e-mail", () => {
    const auth = createAuth(openMemoryDatabase(), { ...OPTIONS, github: GITHUB });

    expect(auth.options.account.accountLinking).toEqual({
      enabled: true,
      trustedProviders: [],
      allowDifferentEmails: false,
    });
  });
});

describe("configureGitHubLogin", () => {
  test("turns GitHub sign-in on and off", () => {
    configureGitHubLogin(GITHUB);
    const enabled = isGitHubLoginEnabled();

    configureGitHubLogin(null);

    expect(enabled).toBe(true);
    expect(isGitHubLoginEnabled()).toBe(false);
  });
});
