import type { Database } from "@/db";
import { generateSshKeyPair } from "@/remote";
import type { SecretBox } from "@/secrets";
import { readPanelPrivateKey, storePanelKeyPair } from "@/servers";

// Lives in the worker: generating keys loads ssh2, whose native modules the web bundle cannot load.
/**
 * Returns the panel's SSH private key, generating the pair on the very first start.
 *
 * @param database - Database.
 * @param secretBox - Encrypts the private key at rest.
 * @returns The private key.
 * @throws {Error} When the generated pair could not be stored.
 */
export async function ensurePanelPrivateKey(
  database: Database,
  secretBox: SecretBox,
): Promise<string> {
  const existing = await readPanelPrivateKey(database, secretBox);
  if (existing != null) {
    return existing;
  }
  await storePanelKeyPair(database, secretBox, generateSshKeyPair());
  const stored = await readPanelPrivateKey(database, secretBox);
  if (stored == null) {
    throw new Error("The panel SSH key pair was not stored");
  }
  return stored;
}
