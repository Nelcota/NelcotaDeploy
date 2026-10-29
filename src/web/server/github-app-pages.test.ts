import { describe, expect, test } from "bun:test";

import { failurePage, isSameState, standalonePage, stateCookie } from "./github-app-pages";

describe("isSameState", () => {
  test("accepts the state stored in the cookie", () => {
    expect(isSameState("abc-123", "abc-123")).toBe(true);
  });

  test.each([
    ["abc-123", "abc-124"],
    ["abc", "abc-123"],
    [null, "abc"],
    ["abc", null],
    ["", ""],
  ])("rejects %p against %p", (received, expected) => {
    expect(isSameState(received, expected)).toBe(false);
  });
});

describe("stateCookie", () => {
  test("is HttpOnly, limited to the app flow and secure over HTTPS", () => {
    expect(stateCookie("abc", true)).toBe(
      "nelcota_github_state=abc; Path=/api/github/app; HttpOnly; SameSite=Lax; Max-Age=600; Secure",
    );
  });

  test("leaves Secure out over plain HTTP", () => {
    expect(stateCookie("abc", false).endsWith("Max-Age=600")).toBe(true);
  });
});

describe("standalonePage", () => {
  test("only lets forms post where the page allows", () => {
    const response = standalonePage({
      title: "x",
      bodyHtml: "",
      formAction: "https://github.com",
    });

    expect(response.headers.get("Content-Security-Policy")).toContain(
      "form-action https://github.com;",
    );
  });

  test("escapes the failure message", async () => {
    const response = failurePage("<script>x</script>", 400);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
});
