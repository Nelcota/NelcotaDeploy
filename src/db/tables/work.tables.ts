// Background work: the job queue, and the tasks a project runs inside its container.
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { users } from "./auth.tables";
import { createdAt, updatedAt } from "./columns";
import { deployments, projects } from "./projects.tables";

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
