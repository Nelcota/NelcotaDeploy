import { type Database, tables } from "@/db";
import type { SecretBox } from "@/secrets";

import { clientSecretContext } from "./github-app.service";

/** The OAuth client of the connected app, used for "Sign in with GitHub". */
export type GitHubLoginCredentials = { readonly clientId: string; readonly clientSecret: string };

/**
 * Decrypts the OAuth client of the connected app.
 *
 * @param database - Database.
 * @param secretBox - Encryption box.
 * @returns The client, or null without an app or for an app created before sign-in existed.
 * @throws {SecretDecryptionError} When the encryption key changed since the app was saved.
 */
export async function readGitHubLoginCredentials(
  database: Database,
  secretBox: SecretBox,
): Promise<GitHubLoginCredentials | null> {
  const row = database
    .select({
      id: tables.githubApps.id,
      clientId: tables.githubApps.clientId,
      encryptedClientSecret: tables.githubApps.encryptedClientSecret,
    })
    .from(tables.githubApps)
    .get();
  if (row?.clientId == null || row.encryptedClientSecret == null) {
    return null;
  }
  const clientSecret = await secretBox.decrypt(
    row.encryptedClientSecret,
    clientSecretContext(row.id),
  );
  return { clientId: row.clientId, clientSecret };
}
