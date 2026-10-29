import type { Database } from "@/db";
import { generateSshKeyPair } from "@/remote";
import type { SecretBox } from "@/secrets";
import { addServer, LOCAL_SERVER_ID, recordServerCheck, storePanelKeyPair } from "@/servers";
import { taskInputSchema } from "@/shared/schemas/task.schema";
import { createTask } from "@/tasks";

const ACTOR = { type: "system", label: "ui-review" } as const;

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
