import { describe, expect, test } from "bun:test";

import { openMemoryDatabase, tables } from "@/db";
import { createTestProject, createTestSecretBox, TEST_ACTOR } from "@/testing";

import { importEnvironmentVariables } from "./environment-import.service";
import {
  listEnvironmentVariables,
  resolveEnvironment,
  saveEnvironmentVariable,
} from "./environment-variable.service";
import { EnvironmentImportConflictError } from "./environment.errors";

describe("importEnvironmentVariables", () => {
  test("retains template credential classification after its sample value was removed", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const box = await createTestSecretBox();
    const project = createTestProject(database);
    await importEnvironmentVariables(database, box, {
      projectId: project.id,
      actor: TEST_ACTOR,
      input: {
        kind: "automatic",
        entries: [
          { key: "ENDPOINT", value: "protected-value", kind: "secret", expectedUpdatedAt: null },
        ],
      },
    });
    expect(listEnvironmentVariables(database, project.id).at(0)).toMatchObject({
      kind: "secret",
      value: null,
    });
    expect(JSON.stringify(database.select().from(tables.environmentVariables).all())).not.toContain(
      "protected-value",
    );
  });
  test("imports a complete batch and encrypts detected credentials before saving", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const box = await createTestSecretBox();
    const project = createTestProject(database);

    const count = await importEnvironmentVariables(database, box, {
      projectId: project.id,
      actor: TEST_ACTOR,
      input: {
        kind: "automatic",
        entries: [
          { key: "NODE_ENV", value: "production", expectedUpdatedAt: null },
          { key: "API_TOKEN", value: "test-only-credential", expectedUpdatedAt: null },
        ],
      },
    });

    expect(count).toBe(2);
    const variables = listEnvironmentVariables(database, project.id);
    expect(variables.find((variable) => variable.key === "API_TOKEN")).toMatchObject({
      kind: "secret",
      value: null,
      excludeFromPreviews: true,
    });
    expect(variables.find((variable) => variable.key === "NODE_ENV")).toMatchObject({
      kind: "plain",
      value: "production",
    });
    expect(JSON.stringify(database.select().from(tables.environmentVariables).all())).not.toContain(
      "test-only-credential",
    );
    expect(JSON.stringify(database.select().from(tables.auditEvents).all())).not.toContain(
      "test-only-credential",
    );
    expect(
      (await resolveEnvironment(database, box, { projectId: project.id })).runtime["API_TOKEN"],
    ).toBe("test-only-credential");
  });

  test("preserves an existing variable's kind, build availability and preview exclusion", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const box = await createTestSecretBox();
    const project = createTestProject(database);
    await saveEnvironmentVariable(database, box, {
      projectId: project.id,
      actor: TEST_ACTOR,
      input: {
        key: "CUSTOM",
        value: "before",
        kind: "secret",
        availableAtBuild: true,
        excludeFromPreviews: true,
      },
    });
    const previous = listEnvironmentVariables(database, project.id).at(0);
    if (previous == null) {
      throw new Error("Expected the saved variable");
    }

    await importEnvironmentVariables(database, box, {
      projectId: project.id,
      actor: TEST_ACTOR,
      input: {
        kind: "automatic",
        entries: [
          { key: "CUSTOM", value: "after", kind: "plain", expectedUpdatedAt: previous.updatedAt },
        ],
      },
    });

    expect(listEnvironmentVariables(database, project.id).at(0)).toMatchObject({
      kind: "secret",
      availableAtBuild: true,
      excludeFromPreviews: true,
    });
    expect(
      (await resolveEnvironment(database, box, { projectId: project.id })).build["CUSTOM"],
    ).toBe("after");
  });

  test("rolls back every write when a later variable cannot be saved", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const box = await createTestSecretBox();
    const project = createTestProject(database);

    const result = importEnvironmentVariables(database, box, {
      projectId: project.id,
      actor: TEST_ACTOR,
      input: {
        kind: "secret",
        entries: [
          { key: "FIRST", value: "valid", expectedUpdatedAt: null },
          { key: "SECOND", value: "", expectedUpdatedAt: null },
        ],
      },
    });

    const error: unknown = await result.catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error ? error.message : "").toContain("needs a value");
    expect(listEnvironmentVariables(database, project.id)).toEqual([]);
    expect(
      database
        .select()
        .from(tables.auditEvents)
        .all()
        .filter((event) => event.action.startsWith("environment_variable.")),
    ).toEqual([]);
  });

  test("refuses to overwrite a variable created after the preview and leaves the batch untouched", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const box = await createTestSecretBox();
    const project = createTestProject(database);
    await saveEnvironmentVariable(database, box, {
      projectId: project.id,
      actor: TEST_ACTOR,
      input: {
        key: "MODE",
        value: "concurrent",
        kind: "plain",
        availableAtBuild: false,
        excludeFromPreviews: false,
      },
    });

    const result = importEnvironmentVariables(database, box, {
      projectId: project.id,
      actor: TEST_ACTOR,
      input: {
        kind: "automatic",
        entries: [
          { key: "NEW", value: "new", expectedUpdatedAt: null },
          { key: "MODE", value: "stale", expectedUpdatedAt: null },
        ],
      },
    });

    const error: unknown = await result.catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(EnvironmentImportConflictError);
    expect(listEnvironmentVariables(database, project.id)).toHaveLength(1);
    expect(listEnvironmentVariables(database, project.id).at(0)?.value).toBe("concurrent");
  });
});
