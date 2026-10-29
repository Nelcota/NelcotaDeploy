import { describe, expect, test } from "bun:test";

import { githubSignInErrorMessage, safeRedirectTarget } from "./sign-in-redirect";

describe("safeRedirectTarget", () => {
  test("follows a path on the panel", () => {
    expect(safeRedirectTarget("/projects/1")).toBe("/projects/1");
  });

  test.each([[undefined], ["https://evil.example"], ["//evil.example"], ["projects"]])(
    "goes to the dashboard instead of %p",
    (target) => {
      expect(safeRedirectTarget(target)).toBe("/");
    },
  );
});

describe("githubSignInErrorMessage", () => {
  test("explains that GitHub cannot create accounts", () => {
    expect(githubSignInErrorMessage("signup_disabled")).toContain("Peça acesso");
  });

  test("falls back to a generic message for unknown codes", () => {
    expect(githubSignInErrorMessage("<script>")).toBe(
      "Não foi possível entrar com o GitHub. Tente novamente.",
    );
  });
});
