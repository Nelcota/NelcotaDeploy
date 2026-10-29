import { describe, expect, test } from "bun:test";

import { openMemoryDatabase, tables } from "@/db";
import { createTestProject, createTestSecretBox, TEST_ACTOR } from "@/testing";

import {
  deleteEnvironmentVariable,
  listEnvironmentVariables,
  resolveEnvironment,
  saveEnvironmentVariable,
} from "./environment-variable.service";

describe("environment variable storage", () => {
  test("stores secrets encrypted and never lists their values", async () => {
    const database = openMemoryDatabase();
    const box = await createTestSecretBox();
    const project = createTestProject(database);

    await saveEnvironmentVariable(database, box, {
      projectId: project.id,
      input: {
        key: "DATABASE_PASSWORD",
        kind: "secret",
        value: "hunter2-secret",
        availableAtBuild: false,
      },
      actor: TEST_ACTOR,
    });

    const stored = database.select().from(tables.environmentVariables).all();
    expect(JSON.stringify(stored)).not.toContain("hunter2-secret");
    expect(listEnvironmentVariables(database, project.id)[0]?.value).toBeNull();
  });

  test("keeps the stored secret when saved again with an empty value", async () => {
    const database = openMemoryDatabase();
    const box = await createTestSecretBox();
    const project = createTestProject(database);
    const secret = {
      key: "TOKEN",
      kind: "secret" as const,
      value: "first-value",
      availableAtBuild: false,
    };
    await saveEnvironmentVariable(database, box, {
      projectId: project.id,
      input: secret,
      actor: TEST_ACTOR,
    });

    await saveEnvironmentVariable(database, box, {
      projectId: project.id,
      input: { ...secret, value: "", availableAtBuild: true },
      actor: TEST_ACTOR,
    });

    const resolved = await resolveEnvironment(database, box, project.id);
    expect(resolved.runtime["TOKEN"]).toBe("first-value");
    expect(resolved.build["TOKEN"]).toBe("first-value");
  });
});

describe("environment variable resolution", () => {
  test("resolves plain and secret values and reports secrets for redaction", async () => {
    const database = openMemoryDatabase();
    const box = await createTestSecretBox();
    const project = createTestProject(database);
    await saveEnvironmentVariable(database, box, {
      projectId: project.id,
      input: { key: "MODE", kind: "plain", value: "prod", availableAtBuild: false },
      actor: TEST_ACTOR,
    });
    await saveEnvironmentVariable(database, box, {
      projectId: project.id,
      input: { key: "KEY", kind: "secret", value: "abc123", availableAtBuild: false },
      actor: TEST_ACTOR,
    });

    const resolved = await resolveEnvironment(database, box, project.id);

    expect(resolved.runtime).toEqual({ MODE: "prod", KEY: "abc123" });
    expect(resolved.build).toEqual({});
    expect(resolved.secretValues).toEqual(["abc123"]);
  });
});

describe("environment variable audit and deletion", () => {
  test("records audit events without secret values", async () => {
    const database = openMemoryDatabase();
    const box = await createTestSecretBox();
    const project = createTestProject(database);

    await saveEnvironmentVariable(database, box, {
      projectId: project.id,
      input: { key: "KEY", kind: "secret", value: "do-not-log-me", availableAtBuild: false },
      actor: TEST_ACTOR,
    });

    const audit = database.select().from(tables.auditEvents).all();
    expect(JSON.stringify(audit)).not.toContain("do-not-log-me");
  });

  test("deletes a variable of the project", async () => {
    const database = openMemoryDatabase();
    const box = await createTestSecretBox();
    const project = createTestProject(database);
    await saveEnvironmentVariable(database, box, {
      projectId: project.id,
      input: { key: "MODE", kind: "plain", value: "x", availableAtBuild: false },
      actor: TEST_ACTOR,
    });
    const [variable] = listEnvironmentVariables(database, project.id);

    deleteEnvironmentVariable(database, {
      projectId: project.id,
      variableId: variable?.id ?? "",
      actor: TEST_ACTOR,
    });

    expect(listEnvironmentVariables(database, project.id)).toEqual([]);
  });
});
