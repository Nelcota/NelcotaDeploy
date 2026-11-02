import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import {
  createProjectDatabase,
  listDatabaseBackups,
  listProjectDatabases,
  requestDatabaseBackup,
  requestDatabaseDeletion,
  requestDatabaseRestore,
  retryDatabaseProvision,
} from "@/databases";
import { getDatabase } from "@/db";
import { applyRuntimeChanges } from "@/deployments";
import { getSecretBox } from "@/secrets";
import { databaseInputSchema } from "@/shared/schemas/database.schema";
import { authorizeProject } from "@/web/server/authorization";

import { idSchema, projectIdInput } from "../ids";

const databaseTarget = z.object({ projectId: idSchema, databaseId: idSchema });

export const listDatabasesFn = createServerFn({ method: "GET" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    await authorizeProject("project:read", data.projectId);
    return listProjectDatabases(getDatabase(), data.projectId);
  });

/** Adds a database; projects that apply changes on their own are recreated with its URL. */
export const createDatabaseFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, database: databaseInputSchema }))
  .handler(async ({ data }) => {
    const user = await authorizeProject("project:write", data.projectId);
    const database = getDatabase();
    await createProjectDatabase(database, await getSecretBox(), {
      projectId: data.projectId,
      input: data.database,
      actor: userActor(user),
    });
    applyRuntimeChanges(database, data.projectId, {
      actor: userActor(user),
      triggeredByUserId: user.id,
    });
  });

/** Starts a database whose provisioning failed again. */
export const retryDatabaseFn = createServerFn({ method: "POST" })
  .validator(databaseTarget)
  .handler(async ({ data }) => {
    const user = await authorizeProject("project:write", data.projectId);
    retryDatabaseProvision(getDatabase(), { ...data, actor: userActor(user) });
  });

/** Deletes a database and its data; only those who may delete projects can do it. */
export const deleteDatabaseFn = createServerFn({ method: "POST" })
  .validator(databaseTarget)
  .handler(async ({ data }) => {
    const user = await authorizeProject("project:delete", data.projectId);
    const database = getDatabase();
    requestDatabaseDeletion(database, { ...data, actor: userActor(user) });
    applyRuntimeChanges(database, data.projectId, {
      actor: userActor(user),
      triggeredByUserId: user.id,
    });
  });

export const listDatabaseBackupsFn = createServerFn({ method: "GET" })
  .validator(databaseTarget)
  .handler(async ({ data }) => {
    await authorizeProject("project:read", data.projectId);
    return listDatabaseBackups(getDatabase(), data);
  });

/** Queues a backup of a database now. */
export const backupDatabaseFn = createServerFn({ method: "POST" })
  .validator(databaseTarget)
  .handler(async ({ data }) => {
    const user = await authorizeProject("project:write", data.projectId);
    requestDatabaseBackup(getDatabase(), { ...data, actor: userActor(user) });
  });

/** Replaces a database's data with a backup; only those who may delete projects can do it. */
export const restoreDatabaseBackupFn = createServerFn({ method: "POST" })
  .validator(databaseTarget.extend({ backupId: idSchema }))
  .handler(async ({ data }) => {
    const user = await authorizeProject("project:delete", data.projectId);
    requestDatabaseRestore(getDatabase(), { ...data, actor: userActor(user) });
  });
