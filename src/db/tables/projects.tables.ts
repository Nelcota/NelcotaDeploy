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
import { LOCAL_SERVER_ID } from "./servers.tables";

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    // Server the next deployment runs on. Existing containers stay where their deployment ran.
    serverId: text("server_id").notNull().default(LOCAL_SERVER_ID),
    repositoryUrl: text("repository_url").notNull(),
    repositoryFullName: text("repository_full_name").notNull(),
    branch: text("branch").notNull(),
    dockerfilePath: text("dockerfile_path").notNull(),
    buildContext: text("build_context").notNull(),
    internalPort: integer("internal_port").notNull(),
    // When set, each build reads the port from the Dockerfile's EXPOSE and stores it above.
    internalPortAuto: integer("internal_port_auto", { mode: "boolean" }).notNull().default(false),
    healthCheckPath: text("health_check_path"),
    autoDeploy: integer("auto_deploy", { mode: "boolean" }).notNull().default(false),
    // When set, saving variables or domains recreates the live container with them.
    autoApplyChanges: integer("auto_apply_changes", { mode: "boolean" }).notNull().default(true),
    // When set, pull requests to the project's branch get their own temporary deployment.
    previewsEnabled: integer("previews_enabled", { mode: "boolean" }).notNull().default(false),
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
    index("projects_server_id_idx").on(table.serverId),
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
    // Kept out of pull request previews, such as the production database URL.
    excludeFromPreviews: integer("exclude_from_previews", { mode: "boolean" })
      .notNull()
      .default(false),
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

// Directories of a project kept between deployments, each a Docker named volume on the
// project's server. A detached volume is no longer mounted but keeps its data until deleted.
export const projectVolumes = sqliteTable(
  "project_volumes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    mountPath: text("mount_path").notNull(),
    attached: integer("attached", { mode: "boolean" }).notNull().default(true),
    deletionRequestedAt: text("deletion_requested_at"),
    deletionError: text("deletion_error"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("project_volumes_project_path_idx").on(table.projectId, table.mountPath)],
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
    // Fingerprint of the build-time variables baked into the image; a redeploy keeps its source's.
    buildConfigHash: text("build_config_hash"),
    containerName: text("container_name"),
    // Server the deployment ran on, which is where its image and container live.
    serverId: text("server_id").notNull().default(LOCAL_SERVER_ID),
    sourceDeploymentId: text("source_deployment_id"),
    // Set for the deployments of a pull request preview; null for production.
    previewId: text("preview_id").references((): AnySQLiteColumn => previews.id, {
      onDelete: "cascade",
    }),
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
    index("deployments_project_server_idx").on(table.projectId, table.serverId),
    index("deployments_preview_idx").on(table.previewId),
  ],
);

// A temporary deployment of a pull request, at its own address, removed when the pull request
// closes. Only pull requests from the project's own repository get one, never forks.
export const previews = sqliteTable(
  "previews",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    pullRequestNumber: integer("pull_request_number").notNull(),
    branch: text("branch").notNull(),
    headSha: text("head_sha").notNull(),
    status: text("status", { enum: ["active", "closed"] }).notNull(),
    currentDeploymentId: text("current_deployment_id").references(
      (): AnySQLiteColumn => deployments.id,
      { onDelete: "set null" },
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    closedAt: text("closed_at"),
  },
  (table) => [
    uniqueIndex("previews_project_number_idx").on(table.projectId, table.pullRequestNumber),
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
