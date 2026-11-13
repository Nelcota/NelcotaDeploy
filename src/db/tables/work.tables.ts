// Background work: the job queue, and the tasks a project runs inside its container.
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { users } from "./auth.tables";
import { createdAt, updatedAt } from "./columns";
import { deployments, projectDatabases, projects } from "./projects.tables";

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind", {
      enum: [
        "deploy",
        "container_action",
        "task_run",
        "project_cleanup",
        "volume_delete",
        "preview_cleanup",
        "database_provision",
        "database_delete",
        "database_backup",
        "database_restore",
        "console_command",
        "proxy_certificate_logs",
      ],
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
    index("jobs_dedupe_history_idx").on(table.dedupeKey, table.createdAt, table.id),
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

// Commands typed in a project's console, run once in its live container. The text stays so
// the person who ran it sees their history; the audit log records it too.
export const consoleCommands = sqliteTable(
  "console_commands",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    command: text("command").notNull(),
    status: text("status", { enum: ["queued", "running", "succeeded", "failed"] }).notNull(),
    exitCode: integer("exit_code"),
    output: text("output").notNull().default(""),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => [
    index("console_commands_project_user_created_idx").on(
      table.projectId,
      table.userId,
      table.createdAt,
    ),
  ],
);

// Dumps of a project database, encrypted and kept in the backup bucket (or the panel's backup
// directory without one). A restore is recorded on the backup it came from.
export const databaseBackups = sqliteTable(
  "database_backups",
  {
    id: text("id").primaryKey(),
    databaseId: text("database_id")
      .notNull()
      .references(() => projectDatabases.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["queued", "running", "succeeded", "failed"] }).notNull(),
    trigger: text("trigger", { enum: ["manual", "scheduled"] }).notNull(),
    // Where the encrypted dump is stored; null until the backup succeeds.
    storageKey: text("storage_key"),
    sizeBytes: integer("size_bytes"),
    errorMessage: text("error_message"),
    restoredAt: text("restored_at"),
    restoreError: text("restore_error"),
    createdAt: createdAt(),
    finishedAt: text("finished_at"),
  },
  (table) => [index("database_backups_database_created_idx").on(table.databaseId, table.createdAt)],
);
