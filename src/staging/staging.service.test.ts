import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { createProjectDatabase } from "@/databases";
import { type Database, openMemoryDatabase, tables } from "@/db";
import {
  completeDeployment,
  getDeployment,
  ProjectNotApprovedError,
  requestDeployment,
  transitionDeployment,
} from "@/deployments";
import { resolveEnvironment, saveEnvironmentVariable } from "@/environments";
import {
  getProject,
  readRepositoryToken,
  requestProjectDeletion,
  setRepositoryToken,
} from "@/projects";
import { createTestProject, createTestSecretBox, TEST_ACTOR } from "@/testing";

import {
  InvalidStagingBranchError,
  NotAProductionProjectError,
  NotAStagingEnvironmentError,
  NothingToPromoteError,
  StagingAlreadyExistsError,
  StagingDeploymentChangedError,
} from "./staging.errors";
import {
  createStagingEnvironment,
  findStagingProject,
  promoteStagingToProduction,
} from "./staging.service";

const ADMIN = { actor: TEST_ACTOR, userId: null, isAdmin: true };
const COMMIT = "c0ffee".padEnd(40, "0");

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

function deployLive(database: Database, projectId: string, commitSha = COMMIT): string {
  const { deploymentId } = requestDeployment(database, {
    projectId,
    trigger: "manual",
    actor: TEST_ACTOR,
    triggeredByUserId: null,
  });
  transitionDeployment(database, deploymentId, { to: "cloning" });
  transitionDeployment(database, deploymentId, {
    to: "building",
    commitSha,
    commitMessage: "feat: checkout",
  });
  transitionDeployment(database, deploymentId, {
    to: "starting",
    imageTag: "nelcota/api-staging:abc",
    containerName: "nelcota-api-staging-abc",
  });
  transitionDeployment(database, deploymentId, { to: "health_checking" });
  completeDeployment(database, deploymentId);
  return deploymentId;
}

describe("createStagingEnvironment", () => {
  test("creates a linked project that deploys the staging branch", async () => {
    const { database, production, create } = await setup();

    const staging = await create();

    expect(staging.parentProjectId).toBe(production.id);
    expect(staging.environmentName).toBe("staging");
    expect(staging.slug).toBe("api-staging");
    expect(staging.branch).toBe("staging");
    expect(staging.repositoryUrl).toBe(production.repositoryUrl);
    expect(findStagingProject(database, production.id)?.id).toBe(staging.id);
  });

  test("copies production variables, secrets included, readable in staging", async () => {
    const context = await setup();
    await saveSecret(context, context.production.id, "API_KEY");

    const staging = await context.create();

    const environment = await resolveEnvironment(context.database, context.secretBox, {
      projectId: staging.id,
    });
    expect(environment.runtime["API_KEY"]).toBe("API_KEY-value");
  });

  test("never copies the URLs of production's managed databases", async () => {
    const context = await setup();
    await createProjectDatabase(context.database, context.secretBox, {
      projectId: context.production.id,
      input: { engine: "postgres", environmentKey: "DATABASE_URL" },
      actor: TEST_ACTOR,
    });

    const staging = await context.create();

    const environment = await resolveEnvironment(context.database, context.secretBox, {
      projectId: staging.id,
    });
    expect(environment.runtime["DATABASE_URL"]).toBeUndefined();
  });

  test("starts without variables when asked not to copy them", async () => {
    const context = await setup();
    await saveSecret(context, context.production.id, "API_KEY");

    const staging = await context.create({ copyVariables: false });

    const environment = await resolveEnvironment(context.database, context.secretBox, {
      projectId: staging.id,
    });
    expect(environment.runtime).toEqual({});
  });

  test("copies the private repository token", async () => {
    const { database, secretBox, production, create } = await setup();
    await setRepositoryToken(database, secretBox, {
      projectId: production.id,
      token: "github_pat_example",
      actor: TEST_ACTOR,
    });

    const staging = await create();

    expect(await readRepositoryToken(database, secretBox, staging.id)).toBe("github_pat_example");
  });

  test("throws StagingAlreadyExistsError for a second staging", async () => {
    const { create } = await setup();
    await create();

    const error = await create().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(StagingAlreadyExistsError);
  });

  test("throws NotAProductionProjectError for the staging of a staging", async () => {
    const { database, secretBox, create } = await setup();
    const staging = await create();

    const error = await createStagingEnvironment(database, secretBox, {
      productionProjectId: staging.id,
      branch: "qa",
      copyVariables: false,
      creator: ADMIN,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotAProductionProjectError);
  });

  test("throws InvalidStagingBranchError for a branch that could be read as an option", async () => {
    const { create } = await setup();

    const error = await create({ branch: "--upload-pack=x" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidStagingBranchError);
  });
});

describe("requestProjectDeletion with staging", () => {
  test("deletes the staging environment with its production project", async () => {
    const { database, production, create } = await setup();
    const staging = await create();

    requestProjectDeletion(database, production.id, TEST_ACTOR);

    const row = database
      .select({ deletionRequestedAt: tables.projects.deletionRequestedAt })
      .from(tables.projects)
      .where(eq(tables.projects.id, staging.id))
      .get();
    expect(row?.deletionRequestedAt).not.toBeNull();
    expect(findStagingProject(database, production.id)).toBeNull();
  });
});

describe("promoteStagingToProduction", () => {
  test("deploys the live staging commit to production", async () => {
    const { database, production, create } = await setup();
    const staging = await create();
    const expectedDeploymentId = deployLive(database, staging.id);

    const { deploymentId } = promoteStagingToProduction(database, {
      stagingProjectId: staging.id,
      expectedDeploymentId,
      actor: TEST_ACTOR,
      triggeredByUserId: null,
    });

    const deployment = getDeployment(database, deploymentId);
    expect(deployment.projectId).toBe(production.id);
    expect(deployment.trigger).toBe("promote");
    expect(deployment.requestedCommitSha).toBe(COMMIT);
  });

  test("throws NothingToPromoteError before staging has a live deployment", async () => {
    const { database, create } = await setup();
    const staging = await create();

    const promote = () =>
      promoteStagingToProduction(database, {
        stagingProjectId: staging.id,
        expectedDeploymentId: "missing-deployment",
        actor: TEST_ACTOR,
        triggeredByUserId: null,
      });

    expect(promote).toThrow(NothingToPromoteError);
  });

  test("throws NotAStagingEnvironmentError for a production project", async () => {
    const { database, production } = await setup();

    const promote = () =>
      promoteStagingToProduction(database, {
        stagingProjectId: production.id,
        expectedDeploymentId: "missing-deployment",
        actor: TEST_ACTOR,
        triggeredByUserId: null,
      });

    expect(promote).toThrow(NotAStagingEnvironmentError);
  });

  test("throws ProjectNotApprovedError while production awaits approval", async () => {
    const { database, production, create } = await setup();
    const staging = await create();
    const expectedDeploymentId = deployLive(database, staging.id);
    database
      .update(tables.projects)
      .set({ deploymentsApproved: false })
      .where(eq(tables.projects.id, production.id))
      .run();

    const promote = () =>
      promoteStagingToProduction(database, {
        stagingProjectId: staging.id,
        expectedDeploymentId,
        actor: TEST_ACTOR,
        triggeredByUserId: null,
      });

    expect(promote).toThrow(ProjectNotApprovedError);
    expect(getProject(database, production.id).currentDeploymentId).toBeNull();
  });
});

test("rejects promotion when staging changes after confirmation opens", async () => {
  const { database, production, create } = await setup();
  const staging = await create();
  const expectedDeploymentId = deployLive(database, staging.id);
  deployLive(database, staging.id, "b".repeat(40));

  const promote = () =>
    promoteStagingToProduction(database, {
      stagingProjectId: staging.id,
      expectedDeploymentId,
      actor: TEST_ACTOR,
      triggeredByUserId: null,
    });

  expect(promote).toThrow(StagingDeploymentChangedError);
  const productionDeployments = database
    .select({ id: tables.deployments.id })
    .from(tables.deployments)
    .where(eq(tables.deployments.projectId, production.id))
    .all();
  expect(productionDeployments).toHaveLength(0);
});

test("rejects an empty confirmed deployment instead of selecting the current one", async () => {
  const { database, create } = await setup();
  const staging = await create();
  deployLive(database, staging.id);

  const promote = () =>
    promoteStagingToProduction(database, {
      stagingProjectId: staging.id,
      expectedDeploymentId: "",
      actor: TEST_ACTOR,
      triggeredByUserId: null,
    });

  expect(promote).toThrow(StagingDeploymentChangedError);
});
