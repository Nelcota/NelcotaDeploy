import {
  createProjectDatabase,
  markBackupFailed,
  markBackupSucceeded,
  markDatabaseFailed,
  markDatabaseRunning,
  requestDatabaseBackup,
} from "@/databases";
import type { Database } from "@/db";
import { requestDeployment } from "@/deployments";
import { openPreview } from "@/previews";
import { generateSshKeyPair } from "@/remote";
import type { SecretBox } from "@/secrets";
import { addServer, LOCAL_SERVER_ID, recordServerCheck, storePanelKeyPair } from "@/servers";
import { taskInputSchema } from "@/shared/schemas/task.schema";
import { createStagingEnvironment } from "@/staging";
import { createTask } from "@/tasks";
import { addProjectVolume, setVolumeAttached } from "@/volumes";

const ACTOR = { type: "system", label: "ui-review" } as const;
const PREVIEW_COMMIT = "4f2c9a1b7d3e8f6a0c5b2d9e1f7a3c8b6d4e0f2a";

/**
 * Marks the panel's host as connected and adds a second server that waits for its install
 * command, so the servers tab shows both states.
 *
 * @param database - Review database.
 * @param secretBox - Encrypts the generated panel key.
 */
export async function seedServers(database: Database, secretBox: SecretBox): Promise<void> {
  recordServerCheck(database, LOCAL_SERVER_ID, {
    status: "ready",
    message: null,
    dockerVersion: "29.0.0",
  });
  await storePanelKeyPair(database, secretBox, generateSshKeyPair());
  addServer(database, {
    input: { name: "aplicacoes-1", host: "203.0.113.10", port: 22, username: "nelcota" },
    actor: ACTOR,
  });
}

/**
 * Adds a manual task and a disabled scheduled one, so the tasks page shows both kinds.
 *
 * @param database - Review database.
 * @param projectId - Project that owns the tasks.
 */
export function seedTasks(database: Database, projectId: string): void {
  const taskContext = { actor: ACTOR, userId: null, timeZone: "America/Sao_Paulo" };
  createTask(database, {
    projectId,
    input: taskInputSchema.parse({
      name: "Migrar banco",
      commandLine: "bun run db:migrate",
      schedule: "",
      enabled: true,
      timeoutInSeconds: 300,
    }),
    ...taskContext,
  });
  createTask(database, {
    projectId,
    input: taskInputSchema.parse({
      name: "Limpar cache",
      commandLine: "bun run cache:clear --all",
      schedule: "0 3 * * *",
      enabled: false,
      timeoutInSeconds: 60,
    }),
    ...taskContext,
  });
}

/**
 * Adds a mounted volume and a detached one, so the settings show both states.
 *
 * @param database - Review database.
 * @param projectId - Project that owns the volumes.
 */
export function seedVolumes(database: Database, projectId: string): void {
  addProjectVolume(database, { projectId, input: { mountPath: "/app/uploads" }, actor: ACTOR });
  const cache = addProjectVolume(database, {
    projectId,
    input: { mountPath: "/var/cache/app" },
    actor: ACTOR,
  });
  setVolumeAttached(database, { projectId, volumeId: cache.id, actor: ACTOR, attached: false });
}

/**
 * Opens a pull request preview with a deployment in the queue, so the project page shows it.
 *
 * @param database - Review database.
 * @param projectId - Project with previews on.
 */
export function seedPreview(database: Database, projectId: string): void {
  const previewId = openPreview(database, {
    projectId,
    number: 42,
    branch: "feature/checkout-pix",
    headSha: PREVIEW_COMMIT,
  });
  requestDeployment(database, {
    projectId,
    trigger: "webhook",
    actor: { type: "webhook", label: "github:ana" },
    triggeredByUserId: null,
    commitSha: PREVIEW_COMMIT,
    commitMessage: "#42 Checkout com Pix",
    previewId,
  });
}

/**
 * Adds a running PostgreSQL with a failed and a successful backup, and a Redis that failed to
 * start, so the databases tab and its backups dialog show each state.
 *
 * @param database - Review database.
 * @param secretBox - Encrypts the passwords and connection URLs.
 * @param projectId - Project that owns the databases.
 */
export async function seedDatabases(
  database: Database,
  secretBox: SecretBox,
  projectId: string,
): Promise<void> {
  const postgres = await createProjectDatabase(database, secretBox, {
    projectId,
    input: { engine: "postgres", environmentKey: "APP_DATABASE_URL" },
    actor: ACTOR,
  });
  markDatabaseRunning(database, postgres.id);
  const target = { projectId, databaseId: postgres.id, actor: ACTOR };
  markBackupFailed(database, requestDatabaseBackup(database, target), "pg_dump failed");
  markBackupSucceeded(database, requestDatabaseBackup(database, target), {
    storageKey: `databases/${postgres.id}/review.dump.enc`,
    sizeBytes: 48_234_496,
  });
  const redis = await createProjectDatabase(database, secretBox, {
    projectId,
    input: { engine: "redis", environmentKey: "REDIS_URL" },
    actor: ACTOR,
  });
  markDatabaseFailed(database, redis.id, "Database container stopped while starting");
}

/**
 * Creates the staging environment of a project, so its header shows the environment switcher.
 *
 * @param database - Review database.
 * @param secretBox - Copies the production secrets.
 * @param projectId - Production project.
 */
export async function seedStaging(
  database: Database,
  secretBox: SecretBox,
  projectId: string,
): Promise<void> {
  await createStagingEnvironment(database, secretBox, {
    productionProjectId: projectId,
    branch: "staging",
    copyVariables: true,
    creator: { actor: ACTOR, userId: null, isAdmin: true },
  });
}
