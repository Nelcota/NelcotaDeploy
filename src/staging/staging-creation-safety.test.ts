import { expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { createProjectDatabase } from "@/databases";
import { type Database, openMemoryDatabase, tables } from "@/db";
import { ProjectNotApprovedError, requestDeployment } from "@/deployments";
import { resolveEnvironment, saveEnvironmentVariable } from "@/environments";
import { readRepositoryToken, setRepositoryToken } from "@/projects";
import { createTestProject, createTestSecretBox, TEST_ACTOR } from "@/testing";

import { createStagingEnvironment, findStagingProject } from "./staging.service";

const ADMIN = { actor: TEST_ACTOR, userId: null, isAdmin: true };

async function setup() {
  const database = openMemoryDatabase();
  const secretBox = await createTestSecretBox();
  const production = createTestProject(database);
  const create = async (overrides: { branch?: string; copyVariables?: boolean } = {}) =>
    await createStagingEnvironment(database, secretBox, {
      productionProjectId: production.id,
      branch: overrides.branch ?? "staging",
      copyVariables: overrides.copyVariables ?? true,
      creator: ADMIN,
    });
  return { database, secretBox, production, create };
}

async function saveSecret(
  context: {
    readonly database: Database;
    readonly secretBox: Awaited<ReturnType<typeof createTestSecretBox>>;
  },
  projectId: string,
  key: string,
): Promise<void> {
  await saveEnvironmentVariable(context.database, context.secretBox, {
    projectId,
    input: {
      key,
      kind: "secret",
      value: `${key}-value`,
      availableAtBuild: false,
      excludeFromPreviews: false,
    },
    actor: TEST_ACTOR,
  });
}

test.each([
  { engine: "postgres", kind: "secret" },
  { engine: "postgres", kind: "plain" },
  { engine: "redis", kind: "secret" },
  { engine: "redis", kind: "plain" },
] as const)(
  "excludes $kind aliases targeting a production $engine host",
  async ({ engine, kind }) => {
    const context = await setup();
    await createProjectDatabase(context.database, context.secretBox, {
      projectId: context.production.id,
      input: { engine, environmentKey: "DATABASE_URL" },
      actor: TEST_ACTOR,
    });
    const productionEnvironment = await resolveEnvironment(context.database, context.secretBox, {
      projectId: context.production.id,
    });
    const connectionUrl = productionEnvironment.runtime["DATABASE_URL"];
    if (connectionUrl == null) {
      throw new Error("Production test database has no connection URL");
    }
    const alias = new URL(connectionUrl);
    alias.hostname = alias.hostname.toUpperCase();
    alias.port = "6543";
    alias.search = "?sslmode=require";
    await saveEnvironmentVariable(context.database, context.secretBox, {
      projectId: context.production.id,
      input: {
        key: "DIRECT_URL",
        kind,
        value: ` ${alias.href} `,
        availableAtBuild: true,
        excludeFromPreviews: true,
      },
      actor: TEST_ACTOR,
    });

    const staging = await context.create();

    const environment = await resolveEnvironment(context.database, context.secretBox, {
      projectId: staging.id,
    });
    expect(environment.runtime["DIRECT_URL"]).toBeUndefined();
    expect(environment.build["DIRECT_URL"]).toBeUndefined();
  },
);

test.each(["", "ordinary text", "https://example.com/path", "postgresql://other-host/app"])(
  "preserves unrelated variable value %j",
  async (value) => {
    const context = await setup();
    await createProjectDatabase(context.database, context.secretBox, {
      projectId: context.production.id,
      input: { engine: "postgres", environmentKey: "DATABASE_URL" },
      actor: TEST_ACTOR,
    });
    await saveEnvironmentVariable(context.database, context.secretBox, {
      projectId: context.production.id,
      input: {
        key: "APP_VALUE",
        kind: "plain",
        value,
        availableAtBuild: false,
        excludeFromPreviews: false,
      },
      actor: TEST_ACTOR,
    });

    const staging = await context.create();

    const environment = await resolveEnvironment(context.database, context.secretBox, {
      projectId: staging.id,
    });
    expect(environment.runtime["APP_VALUE"]).toBe(value);
  },
);

test("blocks deployment until the repository token and variables are copied", async () => {
  const context = await setup();
  await saveSecret(context, context.production.id, "API_KEY");
  await setRepositoryToken(context.database, context.secretBox, {
    projectId: context.production.id,
    token: "github_pat_example",
    actor: TEST_ACTOR,
  });

  const creation = context.create();
  const partial = findStagingProject(context.database, context.production.id);
  if (partial == null) {
    throw new Error("Staging test project was not created");
  }
  const deploy = () =>
    requestDeployment(context.database, {
      projectId: partial.id,
      trigger: "manual",
      actor: TEST_ACTOR,
      triggeredByUserId: null,
    });
  expect(partial.autoDeploy).toBe(false);
  expect(partial.deploymentsApproved).toBe(false);
  expect(deploy).toThrow(ProjectNotApprovedError);
  const staging = await creation;

  expect(staging.autoDeploy).toBe(true);
  expect(staging.deploymentsApproved).toBe(true);
  expect(await readRepositoryToken(context.database, context.secretBox, staging.id)).toBe(
    "github_pat_example",
  );
  const environment = await resolveEnvironment(context.database, context.secretBox, {
    projectId: staging.id,
  });
  expect(environment.runtime["API_KEY"]).toBe("API_KEY-value");
  expect(deploy().created).toBe(true);
});

test("keeps staging unapproved when copying configuration fails", async () => {
  const context = await setup();
  context.database
    .update(tables.projects)
    .set({ encryptedRepositoryToken: "invalid" })
    .where(eq(tables.projects.id, context.production.id))
    .run();

  const error = await context.create().catch((caught: unknown) => caught);

  expect(error).toMatchObject({ name: "SecretDecryptionError" });
  const staging = context.database
    .select({
      autoDeploy: tables.projects.autoDeploy,
      deploymentsApproved: tables.projects.deploymentsApproved,
      deletionRequestedAt: tables.projects.deletionRequestedAt,
    })
    .from(tables.projects)
    .where(eq(tables.projects.parentProjectId, context.production.id))
    .get();
  expect(staging?.autoDeploy).toBe(false);
  expect(staging?.deploymentsApproved).toBe(false);
  expect(staging?.deletionRequestedAt).toBeString();
});

test("still requires admin approval when a developer creates staging", async () => {
  const context = await setup();

  const staging = await createStagingEnvironment(context.database, context.secretBox, {
    productionProjectId: context.production.id,
    branch: "staging",
    copyVariables: true,
    creator: { ...ADMIN, isAdmin: false },
  });

  expect(staging.autoDeploy).toBe(true);
  expect(staging.deploymentsApproved).toBe(false);
  expect(() =>
    requestDeployment(context.database, {
      projectId: staging.id,
      trigger: "manual",
      actor: TEST_ACTOR,
      triggeredByUserId: null,
    }),
  ).toThrow(ProjectNotApprovedError);
});
