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
  ],
);

export const workerHeartbeats = sqliteTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  startedAt: text("started_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  dockerAvailable: integer("docker_available", { mode: "boolean" }).notNull(),
  dockerVersion: text("docker_version"),
});
