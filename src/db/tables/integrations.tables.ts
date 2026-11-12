import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { users } from "./auth.tables";
import { createdAt, updatedAt } from "./columns";

export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    event: text("event").notNull(),
    repositoryFullName: text("repository_full_name"),
    ref: text("ref"),
    commitSha: text("commit_sha"),
    status: text("status", { enum: ["accepted", "ignored"] }).notNull(),
    reason: text("reason").notNull(),
    deploymentIds: text("deployment_ids", { mode: "json" }).$type<string[]>().notNull(),
    receivedAt: text("received_at").notNull(),
  },
  (table) => [index("webhook_deliveries_received_idx").on(table.receivedAt)],
);

export const pullRequestReconciliations = sqliteTable(
  "pull_request_reconciliations",
  {
    repositoryFullName: text("repository_full_name").notNull(),
    pullRequestNumber: integer("pull_request_number").notNull(),
    deliveryId: text("delivery_id").notNull(),
    senderLogin: text("sender_login"),
    nextAttemptAt: text("next_attempt_at"),
    attempts: integer("attempts").notNull().default(0),
    observedState: text("observed_state", { enum: ["open", "closed"] }),
    observedHeadSha: text("observed_head_sha"),
    observedHeadRef: text("observed_head_ref"),
    observedHeadRepository: text("observed_head_repository"),
    observedBaseRef: text("observed_base_ref"),
  },
  (table) => [
    primaryKey({ columns: [table.repositoryFullName, table.pullRequestNumber] }),
    index("pull_request_reconciliations_due_idx").on(table.nextAttemptAt),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorType: text("actor_type", { enum: ["user", "token", "webhook", "system"] }).notNull(),
    actorId: text("actor_id"),
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("audit_events_created_idx").on(table.createdAt),
    index("audit_events_target_idx").on(table.targetType, table.targetId),
  ],
);

export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  scopes: text("scopes", { mode: "json" }).$type<("read" | "deploy")[]>().notNull(),
  createdByUserId: text("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  lastUsedAt: text("last_used_at"),
  expiresAt: text("expires_at"),
  revokedAt: text("revoked_at"),
  createdAt: createdAt(),
});

export const systemSettings = sqliteTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

// The GitHub App created from the panel; at most one row. Its private key and webhook secret
// are encrypted with NELCOTA_ENCRYPTION_KEY.
export const githubApps = sqliteTable("github_apps", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  htmlUrl: text("html_url").notNull(),
  ownerLogin: text("owner_login").notNull(),
  encryptedPrivateKey: text("encrypted_private_key").notNull(),
  encryptedWebhookSecret: text("encrypted_webhook_secret"),
  // OAuth client of the app, for "Sign in with GitHub"; missing on apps created before it.
  clientId: text("client_id"),
  encryptedClientSecret: text("encrypted_client_secret"),
  createdAt: createdAt(),
});
