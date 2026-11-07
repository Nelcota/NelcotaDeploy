import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { MAX_SLUG_LENGTH } from "@/shared/schemas/project.schema";
import { createTestProject } from "@/testing";

import { suggestProjectSlug } from "./project-identity";

describe("suggestProjectSlug", () => {
  test("suggests the normalized name when it is available", () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;

    expect(suggestProjectSlug(database, "Minha aplicação")).toBe("minha-aplicacao");
  });

  test("suggests the next available suffix", () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    createTestProject(database);
    createTestProject(database, { slug: "api-2" });

    expect(suggestProjectSlug(database, "API")).toBe("api-3");
  });

  test("keeps the maximum length when adding a suffix", () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const name = "a".repeat(MAX_SLUG_LENGTH);
    createTestProject(database, { slug: name });
    createTestProject(database, { slug: `${name.slice(0, -2)}-2` });

    expect(suggestProjectSlug(database, name)).toBe(`${name.slice(0, -2)}-3`);
  });

  test.each(["", "  ", "---"])("rejects names without an identifier: %p", (name) => {
    expect(() => suggestProjectSlug(openMemoryDatabase(), name)).toThrow(RangeError);
  });
});
