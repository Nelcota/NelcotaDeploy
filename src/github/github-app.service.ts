import { z } from "zod";

import { type Actor, recordAuditEvent } from "@/audit";
import { type Database, tables } from "@/db";
import type { SecretBox } from "@/secrets";

import { type GitHubApi, githubRequest } from "./github-api";
import { GitHubApiError } from "./github.errors";

const MANIFEST_CODE_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_NAME_LENGTH = 200;

const conversionSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().min(1).max(MAX_NAME_LENGTH),
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  html_url: z.url({ protocol: /^https$/ }),
  owner: z.object({ login: z.string().min(1).max(MAX_NAME_LENGTH) }),
  pem: z.string().includes("PRIVATE KEY"),
  webhook_secret: z.string().min(1).nullable(),
  client_id: z.string().min(1).max(MAX_NAME_LENGTH),
  client_secret: z.string().min(1),
});

/** The app GitHub created from the panel's manifest, with its credentials. */
type GitHubAppConversion = z.infer<typeof conversionSchema>;

/** What the interface shows about the connected app; credentials never leave the server. */
export type GitHubAppSummary = {
  readonly id: string;
  readonly name: string;
  readonly ownerLogin: string;
  readonly htmlUrl: string;
  /** Page where the user picks the repositories the app can read. */
  readonly installUrl: string;
  /** Whether people can sign in with GitHub; apps created before that need reconnecting. */
  readonly loginReady: boolean;
};

/** Credentials the server uses to act as the app. */
export type GitHubAppCredentials = {
  readonly appId: string;
  readonly privateKey: string;
  readonly webhookSecret: string | null;
};

function privateKeyContext(appId: string): string {
  return `github-app:${appId}:private-key`;
}

function webhookSecretContext(appId: string): string {
  return `github-app:${appId}:webhook-secret`;
}

/**
 * Encryption context of the app's OAuth client secret.
 *
 * @param appId - Id of the GitHub App.
 * @returns The associated data the secret is bound to.
 */
export function clientSecretContext(appId: string): string {
  return `github-app:${appId}:client-secret`;
}

/**
 * Exchanges the code GitHub returns after the user creates the app for its credentials.
 *
 * @param api - API location.
 * @param code - Code from the callback; valid for one hour and one use.
 * @returns The new app with its private key and webhook secret.
 * @throws {GitHubApiError} When the code is malformed or GitHub refuses it.
 */
export async function convertManifestCode(
  api: GitHubApi,
  code: string,
): Promise<GitHubAppConversion> {
  if (MANIFEST_CODE_PATTERN.test(code) === false) {
    throw new GitHubApiError("Malformed GitHub App manifest code", null);
  }
  const answer = await githubRequest(api, {
    path: `/app-manifests/${code}/conversions`,
    method: "POST",
  });
  const parsed = conversionSchema.safeParse(answer);
  if (parsed.success === false) {
    throw new GitHubApiError(
      "GitHub answered the manifest conversion with an unexpected body",
      null,
    );
  }
  return parsed.data;
}

/**
 * Stores the app with its credentials encrypted, replacing any app connected before.
 *
 * @param database - Database.
 * @param secretBox - Encryption box.
 * @param connection - The app GitHub created and who connected it.
 * @returns What the interface shows about the app.
 */
export async function saveGitHubApp(
  database: Database,
  secretBox: SecretBox,
  { app, actor }: { readonly app: GitHubAppConversion; readonly actor: Actor },
): Promise<GitHubAppSummary> {
  const appId = String(app.id);
  const encryptedPrivateKey = await secretBox.encrypt(app.pem, privateKeyContext(appId));
  const encryptedWebhookSecret =
    app.webhook_secret == null
      ? null
      : await secretBox.encrypt(app.webhook_secret, webhookSecretContext(appId));
  const encryptedClientSecret = await secretBox.encrypt(
    app.client_secret,
    clientSecretContext(appId),
  );
  database.transaction((transaction) => {
    transaction.delete(tables.githubApps).run();
    transaction
      .insert(tables.githubApps)
      .values({
        id: appId,
        slug: app.slug,
        name: app.name,
        htmlUrl: app.html_url,
        ownerLogin: app.owner.login,
        encryptedPrivateKey,
        encryptedWebhookSecret,
        clientId: app.client_id,
        encryptedClientSecret,
        createdAt: new Date().toISOString(),
      })
      .run();
    recordAuditEvent(transaction, {
      actor,
      action: "github_app.connect",
      targetType: "github_app",
      targetId: appId,
      metadata: { name: app.name, owner: app.owner.login },
    });
  });
  return summaryOf({
    id: appId,
    name: app.name,
    ownerLogin: app.owner.login,
    htmlUrl: app.html_url,
    loginReady: true,
  });
}

function summaryOf(app: Omit<GitHubAppSummary, "installUrl">): GitHubAppSummary {
  return { ...app, installUrl: `${app.htmlUrl}/installations/new` };
}

/**
 * Returns the connected app, without its credentials.
 *
 * @param database - Database.
 * @returns The app, or null when none is connected.
 */
export function getGitHubApp(database: Database): GitHubAppSummary | null {
  const row = database
    .select({
      id: tables.githubApps.id,
      name: tables.githubApps.name,
      ownerLogin: tables.githubApps.ownerLogin,
      htmlUrl: tables.githubApps.htmlUrl,
      clientId: tables.githubApps.clientId,
    })
    .from(tables.githubApps)
    .get();
  if (row == null) {
    return null;
  }
  const { clientId, ...app } = row;
  return summaryOf({ ...app, loginReady: clientId != null });
}

/**
 * Decrypts the credentials of the connected app.
 *
 * @param database - Database.
 * @param secretBox - Encryption box.
 * @returns The credentials, or null when no app is connected.
 * @throws {SecretDecryptionError} When the encryption key changed since the app was saved.
 */
export async function readGitHubAppCredentials(
  database: Database,
  secretBox: SecretBox,
): Promise<GitHubAppCredentials | null> {
  const row = database
    .select({
      id: tables.githubApps.id,
      encryptedPrivateKey: tables.githubApps.encryptedPrivateKey,
      encryptedWebhookSecret: tables.githubApps.encryptedWebhookSecret,
    })
    .from(tables.githubApps)
    .get();
  if (row == null) {
    return null;
  }
  const [privateKey, webhookSecret] = await Promise.all([
    secretBox.decrypt(row.encryptedPrivateKey, privateKeyContext(row.id)),
    row.encryptedWebhookSecret == null
      ? null
      : secretBox.decrypt(row.encryptedWebhookSecret, webhookSecretContext(row.id)),
  ]);
  return { appId: row.id, privateKey, webhookSecret };
}

/**
 * Forgets the connected app. The app itself stays on GitHub until the user deletes it there.
 *
 * @param database - Database.
 * @param actor - Who disconnected it.
 */
export function removeGitHubApp(database: Database, actor: Actor): void {
  database.transaction((transaction) => {
    const removed = transaction
      .delete(tables.githubApps)
      .returning({ id: tables.githubApps.id })
      .all();
    for (const app of removed) {
      recordAuditEvent(transaction, {
        actor,
        action: "github_app.disconnect",
        targetType: "github_app",
        targetId: app.id,
        metadata: {},
      });
    }
  });
}
