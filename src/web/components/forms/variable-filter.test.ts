import { describe, expect, test } from "bun:test";

import { filterVariablesByKey } from "@/web/components/forms/variable-filter";

const VARIABLES = [{ key: "DATABASE_URL" }, { key: "NODE_ENV" }, { key: "REDIS_URL" }];

describe("filterVariablesByKey", () => {
  test("keeps every variable when the search is empty", () => {
    const result = filterVariablesByKey(VARIABLES, "");

    expect(result).toEqual(VARIABLES);
  });

  test("keeps every variable when the search is only spaces", () => {
    const result = filterVariablesByKey(VARIABLES, "   ");

    expect(result).toEqual(VARIABLES);
  });

  test("matches part of the name ignoring case and spaces", () => {
    const result = filterVariablesByKey(VARIABLES, "  url ");

    expect(result.map((variable) => variable.key)).toEqual(["DATABASE_URL", "REDIS_URL"]);
  });

  test("returns nothing when no name contains the search", () => {
    const result = filterVariablesByKey(VARIABLES, "secret");

    expect(result).toEqual([]);
  });

  test("returns nothing for an empty list", () => {
    const result = filterVariablesByKey([], "url");

    expect(result).toEqual([]);
  });
});
