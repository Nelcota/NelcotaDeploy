import { describe, expect, test } from "bun:test";

import {
  isSafeRelativePath,
  isValidBranchName,
  parseGitHubRepository,
  projectInputSchema,
  slugify,
} from "./project.schema";

const validInput = {
  name: "  Minha API ",
  slug: "minha-api",
  repositoryUrl: "https://github.com/Acme/api.git",
  branch: "main",
  dockerfilePath: "Dockerfile",
  buildContext: ".",
  internalPort: "3000",
  healthCheckPath: "",
  autoDeploy: false,
  autoApplyChanges: true,
  previewsEnabled: false,
};

describe("projectInputSchema", () => {
  test("accepts a valid project and normalizes its fields", () => {
    const result = projectInputSchema.parse(validInput);

    expect(result.name).toBe("Minha API");
    expect(result.internalPort).toBe(3000);
    expect(result.healthCheckPath).toBeNull();
  });

  test("rejects a non-GitHub repository URL", () => {
    const result = projectInputSchema.safeParse({
      ...validInput,
      repositoryUrl: "https://gitlab.com/a/b",
    });

    expect(result.success).toBe(false);
  });

  test("rejects a repository URL with embedded credentials", () => {
    const result = projectInputSchema.safeParse({
      ...validInput,
      repositoryUrl: "https://user:token@github.com/acme/api",
    });

    expect(result.success).toBe(false);
  });
});

describe("projectInputSchema field limits", () => {
  test("rejects a Dockerfile path that escapes the repository", () => {
    const result = projectInputSchema.safeParse({
      ...validInput,
      dockerfilePath: "../../etc/passwd",
    });

    expect(result.success).toBe(false);
  });

  test.each([0, -1, 65_536, Number.NaN, 3.5])("rejects internal port %p", (port) => {
    const result = projectInputSchema.safeParse({ ...validInput, internalPort: port });

    expect(result.success).toBe(false);
  });

  test("rejects an uppercase slug", () => {
    const result = projectInputSchema.safeParse({ ...validInput, slug: "Minha-API" });

    expect(result.success).toBe(false);
  });

  test("rejects an empty name made only of spaces", () => {
    const result = projectInputSchema.safeParse({ ...validInput, name: "   " });

    expect(result.success).toBe(false);
  });
});

describe("parseGitHubRepository", () => {
  test("returns a lowercase full name and canonical clone URL", () => {
    expect(parseGitHubRepository("https://github.com/Acme/API.git")).toEqual({
      owner: "Acme",
      name: "API",
      fullName: "acme/api",
      cloneUrl: "https://github.com/Acme/API.git",
    });
  });

  test("returns undefined for an SSH URL", () => {
    expect(parseGitHubRepository("git@github.com:acme/api.git")).toBeUndefined();
  });
});

describe("isValidBranchName", () => {
  test.each(["main", "feature/login", "release-1.2"])("accepts %p", (branch) => {
    expect(isValidBranchName(branch)).toBe(true);
  });

  test.each(["", "-x", "--upload-pack=evil", "a..b", "a b", "a/", "main.lock", "x;rm"])(
    "rejects %p",
    (branch) => {
      expect(isValidBranchName(branch)).toBe(false);
    },
  );
});

describe("isSafeRelativePath", () => {
  test.each(["Dockerfile", "apps/api/Dockerfile", "docker/prod.Dockerfile"])(
    "accepts %p",
    (path) => {
      expect(isSafeRelativePath(path)).toBe(true);
    },
  );

  test.each(["", "/etc/passwd", "../Dockerfile", "a/../../b", "a b"])("rejects %p", (path) => {
    expect(isSafeRelativePath(path)).toBe(false);
  });
});

describe("slugify", () => {
  test("removes accents and replaces separators with hyphens", () => {
    expect(slugify("  Gestão de Pedidos! ")).toBe("gestao-de-pedidos");
  });

  test("returns an empty string when no usable characters remain", () => {
    expect(slugify("!!!")).toBe("");
  });
});
