import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import {
  listEnvironmentVariables,
  resolveEnvironment,
  saveEnvironmentVariable,
} from "@/environments";
import { claimNextJob, failJob } from "@/jobs";
import { ProjectNotFoundError } from "@/projects";
import { MAX_DATABASES_PER_PROJECT } from "@/shared/schemas/database.schema";
import { createTestProject, createTestSecretBox, TEST_ACTOR } from "@/testing";

import {
  findDatabaseRecord,
  markDatabaseFailed,
  markDatabaseRunning,
  readDatabasePassword,
} from "./database-provisioning.service";
import {
  DatabaseBeingDeletedError,
  DatabaseLimitError,
  DatabaseNotFoundError,
  DatabaseVariableConflictError,
  ProjectHasDatabasesError,
} from "./database.errors";
import {
  assertProjectHasNoDatabases,
  createProjectDatabase,
  listProjectDatabases,
  requestDatabaseDeletion,
  retryDatabaseProvision,
} from "./database.service";

async function setup() {
  const database = openMemoryDatabase();
  const secretBox = await createTestSecretBox();
  const project = createTestProject(database);
  const create = async (
    environmentKey = "DATABASE_URL",
    engine: "postgres" | "redis" = "postgres",
  ) =>
    await createProjectDatabase(database, secretBox, {
      projectId: project.id,
      input: { engine, environmentKey },
      actor: TEST_ACTOR,
    });
  const target = (databaseId: string) => ({ projectId: project.id, databaseId, actor: TEST_ACTOR });
  return { database, secretBox, project, create, target };
}

describe("createProjectDatabase", () => {
  test("preserves the successful connection variable when concurrent creates use the same key", async () => {
    const { database, secretBox, project, create } = await setup();

    const results = await Promise.allSettled([create(), create()]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((result) => result.status === "rejected");
    expect(failure?.reason).toBeInstanceOf(DatabaseVariableConflictError);
    const created = listProjectDatabases(database, project.id).at(0);
    const environment = await resolveEnvironment(database, secretBox, { projectId: project.id });
    expect(environment.runtime["DATABASE_URL"]).toEndWith(`@${created?.host}:5432/app`);
  });

  test("enforces the database limit across concurrent creates", async () => {
    const { database, project, create } = await setup();
    const keys = Array.from({ length: MAX_DATABASES_PER_PROJECT + 1 }, (_, index) => `DB_${index}`);

    const results = await Promise.allSettled(keys.map(async (key) => await create(key)));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      MAX_DATABASES_PER_PROJECT,
    );
    expect(results.find((result) => result.status === "rejected")?.reason).toBeInstanceOf(
      DatabaseLimitError,
    );
    expect(listProjectDatabases(database, project.id)).toHaveLength(MAX_DATABASES_PER_PROJECT);
    expect(listEnvironmentVariables(database, project.id)).toHaveLength(MAX_DATABASES_PER_PROJECT);
  });

  test("rolls back the connection variable when queuing provisioning fails", async () => {
    const { database, project, create } = await setup();
    database.$client.run(
      "CREATE TRIGGER reject_job BEFORE INSERT ON jobs BEGIN SELECT RAISE(ABORT, 'Job insert rejected'); END",
    );

    const error = await create().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error ? error.message : "").toContain("Job insert rejected");
    expect(listProjectDatabases(database, project.id)).toEqual([]);
    expect(listEnvironmentVariables(database, project.id)).toEqual([]);
  });

  test("saves the connection URL as a secret variable kept out of previews", async () => {
    const { database, secretBox, project, create } = await setup();

    const created = await create();

    const record = findDatabaseRecord(database, created.id);
    const password = record == null ? "" : await readDatabasePassword(secretBox, record);
    const production = await resolveEnvironment(database, secretBox, { projectId: project.id });
    const preview = await resolveEnvironment(database, secretBox, {
      projectId: project.id,
      forPreview: true,
    });
    const expectedUrl = `postgresql://app:${password}@${created.host}:5432/app`;
    expect(production.runtime["DATABASE_URL"]).toBe(expectedUrl);
    expect(production.secretValues).toContain(expectedUrl);
    expect(preview.runtime["DATABASE_URL"]).toBeUndefined();
  });

  test("builds a Redis URL for a Redis database", async () => {
    const { database, secretBox, project, create } = await setup();

    const created = await create("REDIS_URL", "redis");

    const environment = await resolveEnvironment(database, secretBox, { projectId: project.id });
    expect(environment.runtime["REDIS_URL"]).toStartWith("redis://default:");
    expect(environment.runtime["REDIS_URL"]).toEndWith(`@${created.host}:6379`);
  });

  test("starts provisioning on the worker", async () => {
    const { database, create } = await setup();

    const created = await create();

    const job = claimNextJob(database, "worker-1");
    expect(created.status).toBe("provisioning");
    expect(job?.kind).toBe("database_provision");
    expect(job?.payload).toEqual({ databaseId: created.id });
  });

  test("gives each database its own password", async () => {
    const { database, secretBox, create } = await setup();

    const first = findDatabaseRecord(database, (await create("FIRST_URL")).id);
    const second = findDatabaseRecord(database, (await create("SECOND_URL")).id);

    const passwords = await Promise.all(
      [first, second].map(async (record) =>
        record == null ? "" : await readDatabasePassword(secretBox, record),
      ),
    );
    expect(passwords[0]).toHaveLength(48);
    expect(passwords[0]).not.toBe(passwords[1]);
  });

  test("throws DatabaseVariableConflictError when the variable already exists", async () => {
    const { database, secretBox, project, create } = await setup();
    await saveEnvironmentVariable(database, secretBox, {
      projectId: project.id,
      input: {
        key: "DATABASE_URL",
        kind: "plain",
        value: "postgres://elsewhere",
        availableAtBuild: false,
        excludeFromPreviews: false,
      },
      actor: TEST_ACTOR,
    });

    const error = await create().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DatabaseVariableConflictError);
  });

  test("throws DatabaseLimitError when the project already has the most databases", async () => {
    const { create } = await setup();
    const keys = Array.from({ length: MAX_DATABASES_PER_PROJECT }, (_, index) => `DB_${index}_URL`);
    await Promise.all(keys.map(async (key) => await create(key)));

    const error = await create("ONE_MORE_URL").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DatabaseLimitError);
  });

  test("throws ProjectNotFoundError for a project that does not exist", async () => {
    const { database, secretBox } = await setup();

    const error = await createProjectDatabase(database, secretBox, {
      projectId: "missing",
      input: { engine: "postgres", environmentKey: "DATABASE_URL" },
      actor: TEST_ACTOR,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProjectNotFoundError);
  });
});

describe("requestDatabaseDeletion", () => {
  test("removes the connection variable and queues the deletion", async () => {
    const { database, project, create, target } = await setup();
    const created = await create();
    claimNextJob(database, "worker-1");

    requestDatabaseDeletion(database, target(created.id));

    const keys = listEnvironmentVariables(database, project.id).map((variable) => variable.key);
    expect(keys).not.toContain("DATABASE_URL");
    expect(listProjectDatabases(database, project.id)[0]?.deletionRequestedAt).not.toBeNull();
    expect(database.$client.query("SELECT kind FROM jobs WHERE status = 'queued'").all()).toEqual([
      { kind: "database_delete" },
    ]);
  });

  test("throws DatabaseBeingDeletedError when a deletion is already pending", async () => {
    const { database, create, target } = await setup();
    const created = await create();
    requestDatabaseDeletion(database, target(created.id));

    expect(() => requestDatabaseDeletion(database, target(created.id))).toThrow(
      DatabaseBeingDeletedError,
    );
  });

  test("throws DatabaseNotFoundError for a database of another project", async () => {
    const { database, create } = await setup();
    const created = await create();
    const other = createTestProject(database, { slug: "other" });

    const request = () =>
      requestDatabaseDeletion(database, {
        projectId: other.id,
        databaseId: created.id,
        actor: TEST_ACTOR,
      });

    expect(request).toThrow(DatabaseNotFoundError);
  });
});

describe("retryDatabaseProvision", () => {
  test("queues provisioning again for a failed database", async () => {
    const { database, project, create, target } = await setup();
    const created = await create();
    const job = claimNextJob(database, "worker-1");
    failJob(database, job?.id ?? "", { errorMessage: "timeout", retryable: false });
    markDatabaseFailed(database, created.id, "timeout");

    retryDatabaseProvision(database, target(created.id));

    expect(listProjectDatabases(database, project.id)[0]?.status).toBe("provisioning");
    expect(database.$client.query("SELECT kind FROM jobs WHERE status = 'queued'").all()).toEqual([
      { kind: "database_provision" },
    ]);
  });

  test("does nothing for a database that did not fail", async () => {
    const { database, project, create, target } = await setup();
    const created = await create();
    markDatabaseRunning(database, created.id);

    retryDatabaseProvision(database, target(created.id));

    expect(listProjectDatabases(database, project.id)[0]?.status).toBe("running");
  });

  test("throws DatabaseBeingDeletedError for a database being deleted", async () => {
    const { database, create, target } = await setup();
    const created = await create();
    requestDatabaseDeletion(database, target(created.id));

    expect(() => retryDatabaseProvision(database, target(created.id))).toThrow(
      DatabaseBeingDeletedError,
    );
  });
});

describe("assertProjectHasNoDatabases", () => {
  test("throws ProjectHasDatabasesError when the project has a database", async () => {
    const { database, project, create } = await setup();
    await create();

    expect(() => assertProjectHasNoDatabases(database, project.id)).toThrow(
      ProjectHasDatabasesError,
    );
  });

  test("passes for a project without databases", async () => {
    const { database, project } = await setup();

    expect(() => assertProjectHasNoDatabases(database, project.id)).not.toThrow();
  });
});
