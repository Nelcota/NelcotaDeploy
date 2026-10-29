import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { users } from "./auth.tables";
import { createdAt, updatedAt } from "./columns";

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
    // Fingerprint of the variables and domains the container started with (see runtime-config.ts).
    runtimeConfigHash: text("runtime_config_hash"),
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
