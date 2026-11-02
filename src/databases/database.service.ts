import { asc, eq } from "drizzle-orm";

import { type Actor, recordAuditEvent } from "@/audit";
import { type Database, tables, type Transaction } from "@/db";
import { databaseContainerNameFor } from "@/docker";
import {
  deleteEnvironmentVariable,
  listEnvironmentVariables,
  prepareEnvironmentVariable,
} from "@/environments";
import { enqueueJob } from "@/jobs";
import { getProject } from "@/projects";
import type { SecretBox } from "@/secrets";
import {
  type DatabaseEngineName,
  type DatabaseInput,
  MAX_DATABASES_PER_PROJECT,
} from "@/shared/schemas/database.schema";

import { databaseEngine } from "./database-engines";
import { type DatabaseStatus, passwordContext, setStatus } from "./database-provisioning.service";
import {
  DatabaseBeingDeletedError,
  DatabaseLimitError,
  DatabaseNotFoundError,
  DatabaseVariableConflictError,
  ProjectHasDatabasesError,
} from "./database.errors";

const PASSWORD_BYTES = 24;

/** A database of a project as shown to users. The password is never included. */
type ProjectDatabase = {
  readonly id: string;
  readonly engine: DatabaseEngineName;
  readonly imageTag: string;
  /** Variable of the project that holds the connection URL. */
  readonly environmentKey: string;
  /** Host name applications on the platform network connect to. */
  readonly host: string;
  readonly port: number;
  readonly user: string | null;
  readonly databaseName: string | null;
  /** Whether the platform backs this engine up. */
  readonly backupsAvailable: boolean;
  readonly status: DatabaseStatus;
  /** Why provisioning or deletion last failed. */
  readonly errorMessage: string | null;
  /** When deletion was requested; null when no deletion is pending. */
  readonly deletionRequestedAt: string | null;
  readonly createdAt: string;
};

type DatabaseTarget = {
  readonly projectId: string;
  readonly databaseId: string;
  readonly actor: Actor;
};

const databaseColumns = {
  id: tables.projectDatabases.id,
  engine: tables.projectDatabases.engine,
  imageTag: tables.projectDatabases.imageTag,
  environmentKey: tables.projectDatabases.environmentKey,
  status: tables.projectDatabases.status,
  errorMessage: tables.projectDatabases.errorMessage,
  deletionRequestedAt: tables.projectDatabases.deletionRequestedAt,
  createdAt: tables.projectDatabases.createdAt,
};

function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(PASSWORD_BYTES));
  return Buffer.from(bytes).toString("hex");
}

function toView(row: {
  readonly id: string;
  readonly engine: DatabaseEngineName;
  readonly imageTag: string;
  readonly environmentKey: string;
  readonly status: DatabaseStatus;
  readonly errorMessage: string | null;
  readonly deletionRequestedAt: string | null;
  readonly createdAt: string;
}): ProjectDatabase {
  const engine = databaseEngine(row.engine);
  return {
    ...row,
    host: databaseContainerNameFor(row.id),
    port: engine.port,
    user: engine.user,
    databaseName: engine.databaseName,
    backupsAvailable: engine.backup != null,
  };
}

/**
 * Lists a project's databases, oldest first.
 *
 * @param database - Database or open transaction.
 * @param projectId - Project id.
 * @returns The databases, without passwords.
 */
export function listProjectDatabases(
  database: Database | Transaction,
  projectId: string,
): ProjectDatabase[] {
  return database
    .select(databaseColumns)
    .from(tables.projectDatabases)
    .where(eq(tables.projectDatabases.projectId, projectId))
    .orderBy(asc(tables.projectDatabases.createdAt))
    .all()
    .map(toView);
}

export function getProjectDatabase(
  database: Database | Transaction,
  projectId: string,
  databaseId: string,
): ProjectDatabase {
  const found = listProjectDatabases(database, projectId).find((item) => item.id === databaseId);
  if (found == null) {
    throw new DatabaseNotFoundError(databaseId);
  }
  return found;
}

/** Removes the connection URL variable, when the project still has it. */
function removeConnectionVariable(
  database: Database,
  target: { readonly projectId: string; readonly environmentKey: string; readonly actor: Actor },
): void {
  const variable = listEnvironmentVariables(database, target.projectId).find(
    (item) => item.key === target.environmentKey,
  );
  if (variable == null) {
    return;
  }
  deleteEnvironmentVariable(database, {
    projectId: target.projectId,
    variableId: variable.id,
    actor: target.actor,
  });
}

/**
 * Adds a database to a project. Its connection URL is saved at once as a secret variable kept
 * out of pull request previews, and the worker starts the server on the project's server.
 *
 * @param database - Database.
 * @param secretBox - Encryption box for the password and the URL.
 * @param request - Project, validated `input` and who adds it.
 * @returns The new database, still provisioning.
 * @throws {ProjectNotFoundError} When the project does not exist.
 * @throws {DatabaseLimitError} When the project already has 5 databases.
 * @throws {DatabaseVariableConflictError} When the project already has a variable with the
 *   chosen name.
 */
export async function createProjectDatabase(
  database: Database,
  secretBox: SecretBox,
  request: { readonly projectId: string; readonly input: DatabaseInput; readonly actor: Actor },
): Promise<ProjectDatabase> {
  const { projectId, input, actor } = request;
  assertDatabaseCreationPossible(database, projectId, input.environmentKey);
  const engine = databaseEngine(input.engine);
  const id = Bun.randomUUIDv7();
  const password = generatePassword();
  const encryptedPassword = await secretBox.encrypt(password, passwordContext(id));
  const saveVariable = await prepareEnvironmentVariable(database, secretBox, {
    projectId,
    input: {
      key: input.environmentKey,
      kind: "secret",
      value: engine.connectionUrl(databaseContainerNameFor(id), password),
      availableAtBuild: false,
      excludeFromPreviews: true,
    },
    actor,
  });
  const row = {
    id,
    engine: input.engine,
    imageTag: engine.imageTag,
    environmentKey: input.environmentKey,
    status: "provisioning" as const,
    errorMessage: null,
    deletionRequestedAt: null,
    createdAt: new Date().toISOString(),
  };
  database.transaction((transaction) => {
    // Encryption yields: another request may have added a variable or database meanwhile.
    assertDatabaseCreationPossible(transaction, projectId, input.environmentKey);
    saveVariable(transaction);
    insertDatabase(transaction, { row, projectId, encryptedPassword, actor });
  });
  return toView(row);
}

function assertDatabaseCreationPossible(
  database: Database | Transaction,
  projectId: string,
  environmentKey: string,
): void {
  getProject(database, projectId);
  if (listProjectDatabases(database, projectId).length >= MAX_DATABASES_PER_PROJECT) {
    throw new DatabaseLimitError(MAX_DATABASES_PER_PROJECT);
  }
  if (
    listEnvironmentVariables(database, projectId).some(
      (variable) => variable.key === environmentKey,
    )
  ) {
    throw new DatabaseVariableConflictError(environmentKey);
  }
}

function insertDatabase(
  transaction: Transaction,
  insert: {
    readonly row: Omit<
      ProjectDatabase,
      "host" | "port" | "user" | "databaseName" | "backupsAvailable"
    >;
    readonly projectId: string;
    readonly encryptedPassword: string;
    readonly actor: Actor;
  },
): void {
  const { row, projectId, encryptedPassword, actor } = insert;
  transaction
    .insert(tables.projectDatabases)
    .values({ ...row, projectId, encryptedPassword, updatedAt: row.createdAt })
    .run();
  enqueueProvision(transaction, projectId, row.id);
  recordAuditEvent(transaction, {
    actor,
    action: "database.create",
    targetType: "database",
    targetId: row.id,
    metadata: { projectId, engine: row.engine, environmentKey: row.environmentKey },
  });
}

function enqueueProvision(transaction: Transaction, projectId: string, databaseId: string): void {
  enqueueJob(transaction, {
    kind: "database_provision",
    projectId,
    payload: { databaseId },
    dedupeKey: `database-provision:${databaseId}`,
  });
}

/**
 * Starts provisioning a database again after it failed.
 *
 * @param database - Database.
 * @param target - Project, database and who asks.
 * @throws {DatabaseNotFoundError} When the database is not one of the project's.
 * @throws {DatabaseBeingDeletedError} When it is being deleted.
 */
export function retryDatabaseProvision(database: Database, target: DatabaseTarget): void {
  const { projectId, databaseId, actor } = target;
  database.transaction((transaction) => {
    const found = getProjectDatabase(transaction, projectId, databaseId);
    if (found.deletionRequestedAt != null) {
      throw new DatabaseBeingDeletedError(databaseId);
    }
    if (found.status !== "failed") {
      return;
    }
    setStatus(transaction, databaseId, { status: "provisioning", errorMessage: null });
    enqueueProvision(transaction, projectId, databaseId);
    recordAuditEvent(transaction, {
      actor,
      action: "database.retry",
      targetType: "database",
      targetId: databaseId,
      metadata: { projectId },
    });
  });
}

/**
 * Queues the deletion of a database and its data, and removes its connection URL variable. The
 * database disappears once the worker removed it.
 *
 * @param database - Database.
 * @param target - Project, database and who asks.
 * @throws {DatabaseNotFoundError} When the database is not one of the project's.
 * @throws {DatabaseBeingDeletedError} When a deletion is already pending.
 */
export function requestDatabaseDeletion(database: Database, target: DatabaseTarget): void {
  const { projectId, databaseId, actor } = target;
  const found = database.transaction((transaction) => {
    const existing = getProjectDatabase(transaction, projectId, databaseId);
    if (existing.deletionRequestedAt != null) {
      throw new DatabaseBeingDeletedError(databaseId);
    }
    const now = new Date();
    transaction
      .update(tables.projectDatabases)
      .set({
        deletionRequestedAt: now.toISOString(),
        errorMessage: null,
        updatedAt: now.toISOString(),
      })
      .where(eq(tables.projectDatabases.id, databaseId))
      .run();
    enqueueJob(
      transaction,
      {
        kind: "database_delete",
        projectId,
        payload: { databaseId },
        dedupeKey: `database-delete:${databaseId}`,
      },
      now,
    );
    recordAuditEvent(transaction, {
      actor,
      action: "database.delete",
      targetType: "database",
      targetId: databaseId,
      metadata: { projectId, engine: existing.engine },
    });
    return existing;
  });
  removeConnectionVariable(database, { projectId, environmentKey: found.environmentKey, actor });
}

/**
 * Refuses to move a project that has databases: their data lives on the current server.
 *
 * @param database - Database or open transaction.
 * @param projectId - Project being moved.
 * @throws {ProjectHasDatabasesError} When the project has any database.
 */
export function assertProjectHasNoDatabases(
  database: Database | Transaction,
  projectId: string,
): void {
  if (listProjectDatabases(database, projectId).length > 0) {
    throw new ProjectHasDatabasesError(projectId);
  }
}
