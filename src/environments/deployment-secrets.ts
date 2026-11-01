import { eq } from "drizzle-orm";
import { z } from "zod";

import { type Database, tables } from "@/db";
import type { SecretBox } from "@/secrets";

import { InvalidEnvironmentSnapshotError } from "./environment.errors";

/**
 * Persists the exact secrets needed to redact one deployment, encrypted and bound to its id.
 *
 * @param database - Database.
 * @param secretBox - Encryption box.
 * @param snapshot - Deployment and plaintext values, used only by workers.
 * @throws {InvalidEnvironmentSnapshotError} When the deployment no longer exists.
 */
export async function saveDeploymentSecrets(
  database: Database,
  secretBox: SecretBox,
  snapshot: { readonly deploymentId: string; readonly values: readonly string[] },
): Promise<void> {
  const encryptedSecretValues = await secretBox.encrypt(
    JSON.stringify([...new Set(snapshot.values)]),
    `deployment:${snapshot.deploymentId}:log-secrets`,
  );
  const rows = database
    .update(tables.deployments)
    .set({ encryptedSecretValues })
    .where(eq(tables.deployments.id, snapshot.deploymentId))
    .returning({ id: tables.deployments.id })
    .all();
  if (rows.length === 0) {
    throw new InvalidEnvironmentSnapshotError(snapshot.deploymentId);
  }
}

/**
 * Reads a deployment's encrypted redaction values without exposing them in deployment metadata.
 *
 * @param database - Database.
 * @param secretBox - Encryption box.
 * @param deploymentId - Deployment id, or null for a legacy container without one.
 * @returns Secret values, or null for deployments created before snapshots existed.
 * @throws {InvalidEnvironmentSnapshotError} When the decrypted snapshot is not a string array.
 * @throws {SecretDecryptionError} When the ciphertext or its context cannot be authenticated.
 */
export async function readDeploymentSecrets(
  database: Database,
  secretBox: SecretBox,
  deploymentId: string | null,
): Promise<readonly string[] | null> {
  if (deploymentId == null) {
    return null;
  }
  const row = database
    .select({ encrypted: tables.deployments.encryptedSecretValues })
    .from(tables.deployments)
    .where(eq(tables.deployments.id, deploymentId))
    .get();
  if (row?.encrypted == null) {
    return null;
  }
  const plaintext = await secretBox.decrypt(
    row.encrypted,
    `deployment:${deploymentId}:log-secrets`,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext) as unknown;
  } catch {
    throw new InvalidEnvironmentSnapshotError(deploymentId);
  }
  const result = z.array(z.string()).safeParse(parsed);
  if (result.success === false) {
    throw new InvalidEnvironmentSnapshotError(deploymentId);
  }
  return result.data;
}
