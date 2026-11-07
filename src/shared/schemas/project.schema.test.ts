import { describe, expect, test } from "bun:test";

import {
  CPU_LIMIT_OPTIONS_IN_MILLICORES,
  MAX_MEMORY_LIMIT_IN_MB,
  MIN_MEMORY_LIMIT_IN_MB,
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
    expect(result.memoryLimitInMb).toBeNull();
    expect(result.cpuLimitInMillicores).toBeNull();
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

describe("project resource limit compatibility", () => {
  test.each([MIN_MEMORY_LIMIT_IN_MB, MAX_MEMORY_LIMIT_IN_MB])(
    "accepts the memory boundary %s",
    (limit) => {
      expect(
        projectInputSchema.parse({ ...validInput, memoryLimitInMb: limit }).memoryLimitInMb,
      ).toBe(limit);
    },
  );
  test.each([MIN_MEMORY_LIMIT_IN_MB - 1, MAX_MEMORY_LIMIT_IN_MB + 1, Number.POSITIVE_INFINITY])(
    "rejects an invalid memory limit %s",
    (limit) => {
      expect(projectInputSchema.safeParse({ ...validInput, memoryLimitInMb: limit }).success).toBe(
        false,
      );
    },
  );
  test.each(CPU_LIMIT_OPTIONS_IN_MILLICORES)("accepts a supported CPU limit %s", (limit) => {
    expect(
      projectInputSchema.parse({ ...validInput, cpuLimitInMillicores: limit }).cpuLimitInMillicores,
    ).toBe(limit);
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

describe("projectInputSchema resource limits", () => {
  test("leaves the container unlimited when the limits are absent", () => {
    const result = projectInputSchema.parse(validInput);

    expect(result.memoryLimitInMb).toBeNull();
    expect(result.cpuLimitInMillicores).toBeNull();
  });

  test("reads blank limits as no limit", () => {
    const result = projectInputSchema.parse({
      ...validInput,
      memoryLimitInMb: "",
      cpuLimitInMillicores: "",
    });

    expect(result.memoryLimitInMb).toBeNull();
  });

  test("accepts limits typed as text", () => {
    const result = projectInputSchema.parse({
      ...validInput,
      memoryLimitInMb: "512",
      cpuLimitInMillicores: "500",
    });

    expect(result.memoryLimitInMb).toBe(512);
    expect(result.cpuLimitInMillicores).toBe(500);
  });

  test.each([["32"], ["-1"], ["1.5"], ["muito"], ["2000000"]])(
    "rejects the memory limit %p",
    (memoryLimitInMb) => {
      expect(projectInputSchema.safeParse({ ...validInput, memoryLimitInMb }).success).toBe(false);
    },
  );
});

describe("projectInputSchema Docker Compose", () => {
  const compose = { ...validInput, builder: "compose", composeService: "web" };

  function issuePaths(input: Record<string, unknown>): string[] {
    const result = projectInputSchema.safeParse(input);
    return result.success ? [] : result.error.issues.map((issue) => String(issue.path[0]));
  }

  test("accepts a Compose project with its service and port", () => {
    const result = projectInputSchema.parse(compose);

    expect(result.composeService).toBe("web");
    expect(result.composeFilePath).toBe("compose.yaml");
  });

  test("leaves the Compose service empty for other builders", () => {
    expect(projectInputSchema.parse(validInput).composeService).toBeNull();
  });

  test("requires the service that receives the domains", () => {
    expect(issuePaths({ ...compose, composeService: "" })).toContain("composeService");
  });

  test("requires the port of that service", () => {
    expect(issuePaths({ ...compose, internalPort: "" })).toContain("internalPort");
  });

  test("refuses more than one replica", () => {
    expect(issuePaths({ ...compose, replicas: "2" })).toContain("replicas");
  });

  test("refuses pull request previews", () => {
    expect(issuePaths({ ...compose, previewsEnabled: true })).toContain("previewsEnabled");
  });

  test.each([["Web"], ["-web"], ["web app"]])("refuses the service name %p", (composeService) => {
    expect(issuePaths({ ...compose, composeService })).toContain("composeService");
  });

  test("refuses a Compose file outside the repository", () => {
    expect(issuePaths({ ...compose, composeFilePath: "../compose.yaml" })).toContain(
      "composeFilePath",
    );
  });
});
