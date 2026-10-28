import type { Actor } from "@/audit";
import type { Database } from "@/db";
import { createProject, type Project } from "@/projects";
import { SecretBox } from "@/secrets";
import type { ProjectInput } from "@/shared/project.schema";

/** Actor used by tests for audited operations. */
export const TEST_ACTOR: Actor = { type: "system", label: "test" };

/** A valid 32-byte key (base64) for tests only. */
const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

/**
 * Creates an approved project through the real service.
 *
 * @param database - Test database.
 * @param overrides - Fields to change from the defaults.
 * @returns The project.
 */
export function createTestProject(
  database: Database,
  overrides: Partial<ProjectInput> = {},
): Project {
  return createProject(
    database,
    {
      name: "API",
      slug: "api",
      repositoryUrl: "https://github.com/acme/api",
      branch: "main",
      dockerfilePath: "Dockerfile",
      buildContext: ".",
      internalPort: 3000,
      healthCheckPath: null,
      autoDeploy: true,
      ...overrides,
    },
    { actor: TEST_ACTOR, userId: null, isAdmin: true },
  );
}

/**
 * Builds a secret box with the fixed test key.
 *
 * @returns The box.
 */
export async function createTestSecretBox(): Promise<SecretBox> {
  return await SecretBox.fromBase64Key(TEST_ENCRYPTION_KEY);
}
