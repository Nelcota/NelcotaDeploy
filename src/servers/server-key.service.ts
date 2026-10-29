import { inArray } from "drizzle-orm";

import { type Database, tables } from "@/db";
import { generateSshKeyPair } from "@/remote";
import type { SecretBox } from "@/secrets";

const PUBLIC_KEY_SETTING = "ssh.publicKey";
const PRIVATE_KEY_SETTING = "ssh.encryptedPrivateKey";
const PRIVATE_KEY_CONTEXT = "panel:ssh-private-key";

function readSetting(database: Database, key: string): string | null {
  const [row] = database
    .select({ value: tables.systemSettings.value })
    .from(tables.systemSettings)
    .where(inArray(tables.systemSettings.key, [key]))
    .all();
  return typeof row?.value === "string" && row.value.trim() !== "" ? row.value : null;
}

/**
 * Returns the public key the panel logs in to its servers with.
 *
 * @param database - Database.
 * @returns The `authorized_keys` line, or null until the worker generated the key pair.
 */
export function getPanelPublicKey(database: Database): string | null {
  return readSetting(database, PUBLIC_KEY_SETTING);
}

/**
 * Returns the panel's private SSH key, decrypted.
 *
 * @param database - Database.
 * @param secretBox - Encryption box.
 * @returns The OpenSSH private key, or null when none was generated yet.
 */
async function readPanelPrivateKey(
  database: Database,
  secretBox: SecretBox,
): Promise<string | null> {
  const encrypted = readSetting(database, PRIVATE_KEY_SETTING);
  if (encrypted == null) {
    return null;
  }
  return await secretBox.decrypt(encrypted, PRIVATE_KEY_CONTEXT);
}

/**
 * Stores the panel's key pair unless one exists, keeping the first pair if two workers race.
 * The private key is encrypted like any other secret.
 *
 * @param database - Database.
 * @param secretBox - Encryption box.
 * @param pair - Generated `publicKey` and `privateKey`.
 */
export async function storePanelKeyPair(
  database: Database,
  secretBox: SecretBox,
  pair: { readonly publicKey: string; readonly privateKey: string },
): Promise<void> {
  const encrypted = await secretBox.encrypt(pair.privateKey, PRIVATE_KEY_CONTEXT);
  const updatedAt = new Date().toISOString();
  database.transaction((transaction) => {
    const existing = transaction
      .select({ key: tables.systemSettings.key })
      .from(tables.systemSettings)
      .where(inArray(tables.systemSettings.key, [PUBLIC_KEY_SETTING, PRIVATE_KEY_SETTING]))
      .all();
    if (existing.length > 0) {
      return;
    }
    transaction
      .insert(tables.systemSettings)
      .values([
        { key: PUBLIC_KEY_SETTING, value: pair.publicKey, updatedAt },
        { key: PRIVATE_KEY_SETTING, value: encrypted, updatedAt },
      ])
      .run();
  });
}

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
