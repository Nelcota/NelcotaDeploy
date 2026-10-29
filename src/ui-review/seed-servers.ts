import type { Database } from "@/db";
import { generateSshKeyPair } from "@/remote";
import type { SecretBox } from "@/secrets";
import { addServer, LOCAL_SERVER_ID, recordServerCheck, storePanelKeyPair } from "@/servers";

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
    actor: { type: "system", label: "ui-review" },
  });
}
