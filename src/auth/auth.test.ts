import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";

import { configureGitHubLogin, createAuth, isGitHubLoginEnabled } from "./auth";

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
