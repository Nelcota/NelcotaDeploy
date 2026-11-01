import { expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openMemoryDatabase, tables } from "@/db";
import { getDeployment, requestDeployment } from "@/deployments";
import { createTestProject, createTestSecretBox, TEST_ACTOR } from "@/testing";

import { readDeploymentSecrets, saveDeploymentSecrets } from "./deployment-secrets";
import { InvalidEnvironmentSnapshotError } from "./environment.errors";

function queuedDeployment(database: ReturnType<typeof openMemoryDatabase>) {
  const project = createTestProject(database);
  return requestDeployment(database, {
    projectId: project.id,
    trigger: "manual",
    actor: TEST_ACTOR,
    triggeredByUserId: null,
  }).deploymentId;
}

test("stores deployment redaction values encrypted and keeps them out of public metadata", async () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const deploymentId = queuedDeployment(database);
  const secretBox = await createTestSecretBox();

  await saveDeploymentSecrets(database, secretBox, {
    deploymentId,
    values: ["old-secret", "old-secret"],
  });

  expect(await readDeploymentSecrets(database, secretBox, deploymentId)).toEqual(["old-secret"]);
  const stored = database
    .select({ value: tables.deployments.encryptedSecretValues })
    .from(tables.deployments)
    .get();
  expect(stored?.value).toStartWith("v1:");
  expect(stored?.value).not.toContain("old-secret");
  expect(JSON.stringify(getDeployment(database, deploymentId))).not.toContain(
    "encryptedSecretValues",
  );
});

test("returns null for legacy containers and an empty array for a known empty snapshot", async () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const deploymentId = queuedDeployment(database);
  const secretBox = await createTestSecretBox();

  expect(await readDeploymentSecrets(database, secretBox, deploymentId)).toBeNull();
  expect(await readDeploymentSecrets(database, secretBox, null)).toBeNull();
  await saveDeploymentSecrets(database, secretBox, { deploymentId, values: [] });

  expect(await readDeploymentSecrets(database, secretBox, deploymentId)).toEqual([]);
});

test.each(["not json", '{"secret":"value"}', "[123]"])(
  "rejects a malformed encrypted snapshot %p",
  async (plaintext) => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const deploymentId = queuedDeployment(database);
    const secretBox = await createTestSecretBox();
    const encryptedSecretValues = await secretBox.encrypt(
      plaintext,
      `deployment:${deploymentId}:log-secrets`,
    );
    database
      .update(tables.deployments)
      .set({ encryptedSecretValues })
      .where(eq(tables.deployments.id, deploymentId))
      .run();

    const error = await readDeploymentSecrets(database, secretBox, deploymentId).catch(
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(InvalidEnvironmentSnapshotError);
  },
);

test("refuses to save secrets for a deployment that no longer exists", async () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;

  const error = await saveDeploymentSecrets(database, await createTestSecretBox(), {
    deploymentId: "missing",
    values: [],
  }).catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(InvalidEnvironmentSnapshotError);
});

test("authenticates a snapshot against its owning deployment", async () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const first = queuedDeployment(database);
  const secretBox = await createTestSecretBox();
  const encryptedSecretValues = await secretBox.encrypt(
    '["secret"]',
    "deployment:another:log-secrets",
  );
  database
    .update(tables.deployments)
    .set({ encryptedSecretValues })
    .where(eq(tables.deployments.id, first))
    .run();

  const error = await readDeploymentSecrets(database, secretBox, first).catch(
    (failure: unknown) => failure,
  );
  expect(error).toMatchObject({ name: "SecretDecryptionError" });
});
