import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { createdAt } from "./columns";
import { projects } from "./projects.tables";
import { LOCAL_SERVER_ID } from "./servers.tables";

export const metricSamples = sqliteTable(
  "metric_samples",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    scope: text("scope", { enum: ["host", "container"] }).notNull(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    serverId: text("server_id").notNull().default(LOCAL_SERVER_ID),
    cpuPercent: real("cpu_percent"),
    memoryUsedBytes: integer("memory_used_bytes"),
    memoryTotalBytes: integer("memory_total_bytes"),
    diskUsedBytes: integer("disk_used_bytes"),
    diskTotalBytes: integer("disk_total_bytes"),
    createdAt: createdAt(),
  },
  (table) => [
    index("metric_samples_scope_created_idx").on(table.scope, table.createdAt),
    index("metric_samples_server_created_idx").on(table.serverId, table.scope, table.createdAt),
    index("metric_samples_project_created_idx").on(table.projectId, table.createdAt),
  ],
);

export const containerSnapshots = sqliteTable(
  "container_snapshots",
  {
    containerId: text("container_id").primaryKey(),
    serverId: text("server_id").notNull().default(LOCAL_SERVER_ID),
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
  (table) => [
    index("container_snapshots_project_id_idx").on(table.projectId),
    index("container_snapshots_server_id_idx").on(table.serverId),
    index("container_snapshots_deployment_id_idx").on(table.deploymentId),
  ],
);

export const workerHeartbeats = sqliteTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  startedAt: text("started_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  dockerAvailable: integer("docker_available", { mode: "boolean" }).notNull(),
  dockerVersion: text("docker_version"),
});

// Health problems already announced, so each one alerts once when it starts and once when it
// is resolved, instead of on every check.
// One HTTP check of a public hostname, as a visitor would make it. Only the outcome and the
// timing are kept, never the response.
export const uptimeChecks = sqliteTable(
  "uptime_checks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull(),
    up: integer("up", { mode: "boolean" }).notNull(),
    statusCode: integer("status_code"),
    responseTimeInMs: integer("response_time_in_ms"),
    error: text("error"),
    checkedAt: text("checked_at").notNull(),
  },
  (table) => [
    index("uptime_checks_hostname_checked_idx").on(table.hostname, table.checkedAt),
    index("uptime_checks_project_checked_idx").on(table.projectId, table.checkedAt),
    index("uptime_checks_checked_idx").on(table.checkedAt),
  ],
);

// Current state of each checked hostname, so a change alerts once and the certificate is
// read once a day.
export const uptimeStates = sqliteTable(
  "uptime_states",
  {
    hostname: text("hostname").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["unknown", "up", "down", "private"] }).notNull(),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    changedAt: text("changed_at").notNull(),
    certificateExpiresAt: text("certificate_expires_at"),
    certificateCheckedAt: text("certificate_checked_at"),
    certificateAlertedAt: text("certificate_alerted_at"),
  },
  (table) => [index("uptime_states_project_idx").on(table.projectId)],
);

export const healthAlerts = sqliteTable("health_alerts", {
  key: text("key").primaryKey(),
  title: text("title").notNull(),
  text: text("text").notNull(),
  openedAt: text("opened_at").notNull(),
});
