import { describe, expect, test } from "bun:test";

import { toggleScope } from "./token-scopes";

describe("toggleScope", () => {
  test("adds a scope at the end when checked", () => {
    const scopes = toggleScope(["read"], "deploy", true);

    expect(scopes).toEqual(["read", "deploy"]);
  });

  test("removes a scope when unchecked", () => {
    const scopes = toggleScope(["read", "deploy"], "read", false);

    expect(scopes).toEqual(["deploy"]);
  });

  test("returns an empty selection when the last scope is unchecked", () => {
    const scopes = toggleScope(["read"], "read", false);

    expect(scopes).toEqual([]);
  });
});
