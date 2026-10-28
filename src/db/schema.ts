import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Platform tables store timestamps as UTC ISO 8601 strings, which sort lexicographically.
// Better Auth tables keep the millisecond integers its adapter expects.

const createdAt = () => text("created_at").notNull();
const updatedAt = () => text("updated_at").notNull();

/* -------------------------------------------------------------------------- */
/* Better Auth                                                                */
/* -------------------------------------------------------------------------- */

export const users = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  role: text("role", { enum: ["admin", "developer", "viewer"] })
    .notNull()
    .default("viewer"),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const sessions = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const accounts = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verifications = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

/* -------------------------------------------------------------------------- */
/* Projects                                                                   */
/* -------------------------------------------------------------------------- */

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    // Only "local" exists today; the column keeps room for more servers later.
    serverId: text("server_id").notNull().default("local"),
    repositoryUrl: text("repository_url").notNull(),
    repositoryFullName: text("repository_full_name").notNull(),
    branch: text("branch").notNull(),
    dockerfilePath: text("dockerfile_path").notNull(),
    buildContext: text("build_context").notNull(),
    internalPort: integer("internal_port").notNull(),
    healthCheckPath: text("health_check_path"),
    autoDeploy: integer("auto_deploy", { mode: "boolean" }).notNull().default(false),
    deploymentsApproved: integer("deployments_approved", { mode: "boolean" })
      .notNull()
      .default(false),
    encryptedRepositoryToken: text("encrypted_repository_token"),
    // Set when deletion is requested; the worker removes containers and images, then the row.
    deletionRequestedAt: text("deletion_requested_at"),
    currentDeploymentId: text("current_deployment_id").references(
      (): AnySQLiteColumn => deployments.id,
      { onDelete: "set null" },
    ),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("projects_repository_full_name_idx").on(table.repositoryFullName),
    index("projects_name_idx").on(table.name),
  ],
);

export const environments = sqliteTable(
  "environments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("environments_project_name_idx").on(table.projectId, table.name)],
);

export const environmentVariables = sqliteTable(
  "environment_variables",
  {
    id: text("id").primaryKey(),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    kind: text("kind", { enum: ["plain", "secret"] }).notNull(),
    plainValue: text("plain_value"),
    encryptedValue: text("encrypted_value"),
    availableAtBuild: integer("available_at_build", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("environment_variables_environment_key_idx").on(table.environmentId, table.key),
  ],
);

export const domains = sqliteTable(
  "domains",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull().unique(),
    httpsEnabled: integer("https_enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [index("domains_project_id_idx").on(table.projectId)],
);

/* -------------------------------------------------------------------------- */
/* Deployments and jobs                                                       */
/* -------------------------------------------------------------------------- */

export const deployments = sqliteTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: [
        "queued",
        "cloning",
        "building",
        "starting",
        "health_checking",
        "succeeded",
        "failed",
        "cancelled",
      ],
    }).notNull(),
    trigger: text("trigger", {
      enum: ["manual", "webhook", "redeploy", "rollback", "mcp"],
    }).notNull(),
    triggeredByUserId: text("triggered_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    triggeredByLabel: text("triggered_by_label").notNull(),
    branch: text("branch").notNull(),
    requestedCommitSha: text("requested_commit_sha"),
    commitSha: text("commit_sha"),
    commitMessage: text("commit_message"),
    imageTag: text("image_tag"),
    containerName: text("container_name"),
    sourceDeploymentId: text("source_deployment_id"),
    errorMessage: text("error_message"),
    cancelRequestedAt: text("cancel_requested_at"),
    createdAt: createdAt(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => [
    index("deployments_project_created_idx").on(table.projectId, table.createdAt),
    index("deployments_created_idx").on(table.createdAt),
    index("deployments_status_idx").on(table.status),
  ],
);

export const deploymentLogs = sqliteTable(
  "deployment_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    stream: text("stream", { enum: ["system", "stdout", "stderr"] }).notNull(),
    level: text("level", { enum: ["info", "warn", "error"] }).notNull(),
    message: text("message").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("deployment_logs_deployment_id_idx").on(table.deploymentId, table.id)],
);

export const runtimeLogs = sqliteTable(
  "runtime_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    deploymentId: text("deployment_id"),
    stream: text("stream", { enum: ["stdout", "stderr"] }).notNull(),
    message: text("message").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("runtime_logs_project_id_idx").on(table.projectId, table.id),
    index("runtime_logs_created_idx").on(table.createdAt),
  ],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind", {
      enum: ["deploy", "container_action", "task_run", "project_cleanup"],
    }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "succeeded", "failed", "cancelled"],
    }).notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    deploymentId: text("deployment_id").references(() => deployments.id, {
      onDelete: "cascade",
    }),
    taskExecutionId: text("task_execution_id").references(() => taskExecutions.id, {
      onDelete: "cascade",
    }),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    dedupeKey: text("dedupe_key"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(1),
    runAfter: text("run_after").notNull(),
    leaseExpiresAt: text("lease_expires_at"),
    workerId: text("worker_id"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => [
    index("jobs_status_run_after_idx").on(table.status, table.runAfter),
    index("jobs_project_id_idx").on(table.projectId),
    // The database itself refuses a second running job for the same project.
    uniqueIndex("jobs_one_running_per_project_idx")
      .on(table.projectId)
      .where(sql`status = 'running'`),
    uniqueIndex("jobs_active_dedupe_key_idx")
      .on(table.dedupeKey)
      .where(sql`status IN ('queued', 'running') AND dedupe_key IS NOT NULL`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Tasks                                                                      */
/* -------------------------------------------------------------------------- */

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    command: text("command", { mode: "json" }).$type<string[]>().notNull(),
    schedule: text("schedule"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    timeoutInSeconds: integer("timeout_in_seconds").notNull(),
    nextRunAt: text("next_run_at"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("tasks_project_name_idx").on(table.projectId, table.name),
    index("tasks_next_run_at_idx").on(table.enabled, table.nextRunAt),
  ],
);

export const taskExecutions = sqliteTable(
  "task_executions",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    trigger: text("trigger", { enum: ["manual", "schedule", "mcp"] }).notNull(),
    scheduledFor: text("scheduled_for"),
    status: text("status", {
      enum: ["queued", "running", "succeeded", "failed"],
    }).notNull(),
    exitCode: integer("exit_code"),
    output: text("output").notNull().default(""),
    errorMessage: text("error_message"),
    triggeredByUserId: text("triggered_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => [
    index("task_executions_task_created_idx").on(table.taskId, table.createdAt),
    // A scheduled slot runs at most once, even if the scheduler restarts mid-tick.
    uniqueIndex("task_executions_task_slot_idx").on(table.taskId, table.scheduledFor),
  ],
);

/* -------------------------------------------------------------------------- */
/* Monitoring                                                                 */
/* -------------------------------------------------------------------------- */

export const metricSamples = sqliteTable(
  "metric_samples",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    scope: text("scope", { enum: ["host", "container"] }).notNull(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    cpuPercent: real("cpu_percent"),
    memoryUsedBytes: integer("memory_used_bytes"),
    memoryTotalBytes: integer("memory_total_bytes"),
    diskUsedBytes: integer("disk_used_bytes"),
    diskTotalBytes: integer("disk_total_bytes"),
    createdAt: createdAt(),
  },
  (table) => [
    index("metric_samples_scope_created_idx").on(table.scope, table.createdAt),
    index("metric_samples_project_created_idx").on(table.projectId, table.createdAt),
  ],
);

export const containerSnapshots = sqliteTable(
  "container_snapshots",
  {
    containerId: text("container_id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    deploymentId: text("deployment_id"),
    name: text("name").notNull(),
    image: text("image").notNull(),
    state: text("state").notNull(),
    health: text("health"),
    restartCount: integer("restart_count").notNull().default(0),
    startedAt: text("started_at"),
    observedAt: text("observed_at").notNull(),
  },
  (table) => [index("container_snapshots_project_id_idx").on(table.projectId)],
);

export const workerHeartbeats = sqliteTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  startedAt: text("started_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  dockerAvailable: integer("docker_available", { mode: "boolean" }).notNull(),
  dockerVersion: text("docker_version"),
});

/* -------------------------------------------------------------------------- */
/* Integrations, audit and settings                                           */
/* -------------------------------------------------------------------------- */

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
