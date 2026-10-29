import { and, asc, eq } from "drizzle-orm";

import { type Actor, recordAuditEvent } from "@/audit";
import { type Database, tables, type Transaction } from "@/db";
import { getProject, PRODUCTION_ENVIRONMENT } from "@/projects";
import type { SecretBox } from "@/secrets";
import type { EnvironmentVariableInput } from "@/shared/schemas/environment-variable.schema";

import { EnvironmentVariableNotFoundError } from "./environment.errors";

/** A variable as shown to users. Secret values are never included. */
export type EnvironmentVariableView = {
  readonly id: string;
  readonly key: string;
  readonly kind: "plain" | "secret";
  /** Plain values only; always null for secrets. */
  readonly value: string | null;
  readonly availableAtBuild: boolean;
  readonly updatedAt: string;
};

/** Decrypted variables handed to the worker for one deployment. */
export type ResolvedEnvironment = {
  readonly runtime: Readonly<Record<string, string>>;
  readonly build: Readonly<Record<string, string>>;
  /** Secret plaintexts, used to redact logs. */
  readonly secretValues: readonly string[];
};

function encryptionContext(environmentId: string, key: string): string {
  return `environment:${environmentId}:${key}`;
}

function productionEnvironmentId(database: Database, projectId: string): string {
  getProject(database, projectId);
  const environment = database
    .select({ id: tables.environments.id })
    .from(tables.environments)
    .where(
      and(
        eq(tables.environments.projectId, projectId),
        eq(tables.environments.name, PRODUCTION_ENVIRONMENT),
      ),
    )
    .get();
  if (environment == null) {
    throw new Error(`Project ${projectId} has no ${PRODUCTION_ENVIRONMENT} environment`);
  }
  return environment.id;
}

/**
 * Lists a project's variables with secret values masked.
 *
 * @param database - Database.
 * @param projectId - Project id.
 * @returns Variables sorted by key.
 * @throws {ProjectNotFoundError} When the project does not exist.
 */
export function listEnvironmentVariables(
  database: Database,
  projectId: string,
): EnvironmentVariableView[] {
  const environmentId = productionEnvironmentId(database, projectId);
  return database
    .select({
      id: tables.environmentVariables.id,
      key: tables.environmentVariables.key,
      kind: tables.environmentVariables.kind,
      plainValue: tables.environmentVariables.plainValue,
      availableAtBuild: tables.environmentVariables.availableAtBuild,
      updatedAt: tables.environmentVariables.updatedAt,
    })
    .from(tables.environmentVariables)
    .where(eq(tables.environmentVariables.environmentId, environmentId))
    .orderBy(asc(tables.environmentVariables.key))
    .all()
    .map((row) => ({
      id: row.id,
      key: row.key,
      kind: row.kind,
      value: row.kind === "plain" ? row.plainValue : null,
      availableAtBuild: row.availableAtBuild,
      updatedAt: row.updatedAt,
    }));
}

/**
 * Creates or replaces a variable by key. Secrets are encrypted before they reach the database.
 *
 * @remarks
 * Saving a secret with an empty value keeps the stored value, so the editor can change
 * other fields without re-typing a secret it never received.
 *
 * @param database - Database.
 * @param secretBox - Encryption box.
 * @param change - Project id, validated variable and who changes it.
 * @throws {ProjectNotFoundError} When the project does not exist.
 */
export async function saveEnvironmentVariable(
  database: Database,
  secretBox: SecretBox,
  {
    projectId,
    input,
    actor,
  }: {
    readonly projectId: string;
    readonly input: EnvironmentVariableInput;
    readonly actor: Actor;
  },
): Promise<void> {
  const environmentId = productionEnvironmentId(database, projectId);
  const keepExistingSecret = input.kind === "secret" && input.value === "";
  const encryptedValue =
    input.kind === "secret" && keepExistingSecret === false
      ? await secretBox.encrypt(input.value, encryptionContext(environmentId, input.key))
      : null;
  const now = new Date().toISOString();
  database.transaction((transaction) => {
    const existing = findVariable(transaction, environmentId, input.key);
    const values = {
      kind: input.kind,
      plainValue: input.kind === "plain" ? input.value : null,
      encryptedValue: keepExistingSecret ? (existing?.encryptedValue ?? null) : encryptedValue,
      availableAtBuild: input.availableAtBuild,
      updatedAt: now,
    };
    if (input.kind === "secret" && values.encryptedValue == null) {
      throw new Error(`Secret ${input.key} needs a value`);
    }
    writeVariable(transaction, { existingId: existing?.id, environmentId, key: input.key, values });
    recordAuditEvent(transaction, {
      actor,
      action: existing == null ? "environment_variable.create" : "environment_variable.update",
      targetType: "project",
      targetId: projectId,
      metadata: { key: input.key, kind: input.kind },
    });
  });
}

type VariableValues = {
  readonly kind: "plain" | "secret";
  readonly plainValue: string | null;
  readonly encryptedValue: string | null;
  readonly availableAtBuild: boolean;
  readonly updatedAt: string;
};

/** Inserts the variable, or updates it in place when it already exists. */
function writeVariable(
  transaction: Transaction,
  target: {
    readonly existingId: string | undefined;
    readonly environmentId: string;
    readonly key: string;
    readonly values: VariableValues;
  },
): void {
  const { existingId, environmentId, key, values } = target;
  if (existingId == null) {
    transaction
      .insert(tables.environmentVariables)
      .values({
        id: Bun.randomUUIDv7(),
        environmentId,
        key,
        createdAt: values.updatedAt,
        ...values,
      })
      .run();
    return;
  }
  transaction
    .update(tables.environmentVariables)
    .set(values)
    .where(eq(tables.environmentVariables.id, existingId))
    .run();
}

function findVariable(transaction: Transaction, environmentId: string, key: string) {
  return transaction
    .select({
      id: tables.environmentVariables.id,
      encryptedValue: tables.environmentVariables.encryptedValue,
    })
    .from(tables.environmentVariables)
    .where(
      and(
        eq(tables.environmentVariables.environmentId, environmentId),
        eq(tables.environmentVariables.key, key),
      ),
    )
    .get();
}

/**
 * Deletes a variable.
 *
 * @param database - Database.
 * @param removal - Owning project, variable id and who deletes it.
 * @throws {EnvironmentVariableNotFoundError} When the variable is not in this project.
 */
export function deleteEnvironmentVariable(
  database: Database,
  {
    projectId,
    variableId,
    actor,
  }: { readonly projectId: string; readonly variableId: string; readonly actor: Actor },
): void {
  const environmentId = productionEnvironmentId(database, projectId);
  database.transaction((transaction) => {
    const deleted = transaction
      .delete(tables.environmentVariables)
      .where(
        and(
          eq(tables.environmentVariables.id, variableId),
          eq(tables.environmentVariables.environmentId, environmentId),
        ),
      )
      .returning({ key: tables.environmentVariables.key })
      .get();
    if (deleted == null) {
      throw new EnvironmentVariableNotFoundError(variableId);
    }
    recordAuditEvent(transaction, {
      actor,
      action: "environment_variable.delete",
      targetType: "project",
      targetId: projectId,
      metadata: { key: deleted.key },
    });
  });
}

/**
 * Decrypts every variable of a project for a deployment.
 *
 * @param database - Database.
 * @param secretBox - Encryption box.
 * @param projectId - Project id.
 * @returns Runtime variables, build-time variables and secret plaintexts for redaction.
 * @throws {SecretDecryptionError} When a stored secret cannot be decrypted with the current key.
 */
export async function resolveEnvironment(
  database: Database,
  secretBox: SecretBox,
  projectId: string,
): Promise<ResolvedEnvironment> {
  const environmentId = productionEnvironmentId(database, projectId);
  const rows = database
    .select({
      key: tables.environmentVariables.key,
      kind: tables.environmentVariables.kind,
      plainValue: tables.environmentVariables.plainValue,
      encryptedValue: tables.environmentVariables.encryptedValue,
      availableAtBuild: tables.environmentVariables.availableAtBuild,
    })
    .from(tables.environmentVariables)
    .where(eq(tables.environmentVariables.environmentId, environmentId))
    .all();
  const decrypted = await Promise.all(
    rows.map(async (row) => ({
      key: row.key,
      kind: row.kind,
      availableAtBuild: row.availableAtBuild,
      value:
        row.kind === "secret"
          ? await secretBox.decrypt(
              row.encryptedValue ?? "",
              encryptionContext(environmentId, row.key),
            )
          : (row.plainValue ?? ""),
    })),
  );
  const runtime: Record<string, string> = {};
  const build: Record<string, string> = {};
  for (const row of decrypted) {
    runtime[row.key] = row.value;
    if (row.availableAtBuild) {
      build[row.key] = row.value;
    }
  }
  return {
    runtime,
    build,
    secretValues: decrypted.filter((row) => row.kind === "secret").map((row) => row.value),
  };
}
