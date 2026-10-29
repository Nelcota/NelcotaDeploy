import { describe, expect, test } from "bun:test";

import { identityFromRepository } from "./repository-identity";

const EMPTY = { name: "", slug: "" };

describe("identityFromRepository", () => {
  test("suggests the repository name for an empty name and identifier", () => {
    const identity = identityFromRepository("https://github.com/acme/Api_Pagamentos", EMPTY);

    expect(identity).toEqual({ name: "Api_Pagamentos", slug: "api-pagamentos" });
  });

  test("keeps a name the user already typed", () => {
    const identity = identityFromRepository("https://github.com/acme/api", {
      name: "Minha API",
      slug: "",
    });

    expect(identity).toEqual({ slug: "api" });
  });

  test("suggests nothing while the URL is not a GitHub repository yet", () => {
    expect(identityFromRepository("https://github.com/ac", EMPTY)).toEqual({});
  });

  test("suggests nothing for blank text", () => {
    expect(identityFromRepository("   ", EMPTY)).toEqual({});
  });
});
