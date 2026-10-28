CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`created_by_user_id` text,
	`last_used_at` text,
	`expires_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`actor_label` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`metadata` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_created_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_target_idx` ON `audit_events` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `container_snapshots` (
	`container_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`deployment_id` text,
	`name` text NOT NULL,
	`image` text NOT NULL,
	`state` text NOT NULL,
	`health` text,
	`restart_count` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`observed_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `container_snapshots_project_id_idx` ON `container_snapshots` (`project_id`);--> statement-breakpoint
CREATE TABLE `deployment_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deployment_id` text NOT NULL,
	`stream` text NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deployment_logs_deployment_id_idx` ON `deployment_logs` (`deployment_id`,`id`);--> statement-breakpoint
CREATE TABLE `deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text NOT NULL,
	`trigger` text NOT NULL,
	`triggered_by_user_id` text,
	`triggered_by_label` text NOT NULL,
	`branch` text NOT NULL,
	`requested_commit_sha` text,
	`commit_sha` text,
	`commit_message` text,
	`image_tag` text,
	`container_name` text,
	`source_deployment_id` text,
	`error_message` text,
	`cancel_requested_at` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`triggered_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `deployments_project_created_idx` ON `deployments` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `deployments_created_idx` ON `deployments` (`created_at`);--> statement-breakpoint
CREATE INDEX `deployments_status_idx` ON `deployments` (`status`);--> statement-breakpoint
CREATE TABLE `domains` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`hostname` text NOT NULL,
	`https_enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_hostname_unique` ON `domains` (`hostname`);--> statement-breakpoint
CREATE INDEX `domains_project_id_idx` ON `domains` (`project_id`);--> statement-breakpoint
CREATE TABLE `environment_variables` (
	`id` text PRIMARY KEY NOT NULL,
	`environment_id` text NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`plain_value` text,
	`encrypted_value` text,
	`available_at_build` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `environment_variables_environment_key_idx` ON `environment_variables` (`environment_id`,`key`);--> statement-breakpoint
CREATE TABLE `environments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `environments_project_name_idx` ON `environments` (`project_id`,`name`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`project_id` text NOT NULL,
	`deployment_id` text,
	`task_execution_id` text,
	`payload` text NOT NULL,
	`dedupe_key` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 1 NOT NULL,
	`run_after` text NOT NULL,
	`lease_expires_at` text,
	`worker_id` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_execution_id`) REFERENCES `task_executions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_status_run_after_idx` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE INDEX `jobs_project_id_idx` ON `jobs` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_one_running_per_project_idx` ON `jobs` (`project_id`) WHERE status = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_active_dedupe_key_idx` ON `jobs` (`dedupe_key`) WHERE status IN ('queued', 'running') AND dedupe_key IS NOT NULL;--> statement-breakpoint
CREATE TABLE `metric_samples` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text NOT NULL,
	`project_id` text,
	`cpu_percent` real,
	`memory_used_bytes` integer,
	`memory_total_bytes` integer,
	`disk_used_bytes` integer,
	`disk_total_bytes` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `metric_samples_scope_created_idx` ON `metric_samples` (`scope`,`created_at`);--> statement-breakpoint
CREATE INDEX `metric_samples_project_created_idx` ON `metric_samples` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`server_id` text DEFAULT 'local' NOT NULL,
	`repository_url` text NOT NULL,
	`repository_full_name` text NOT NULL,
	`branch` text NOT NULL,
	`dockerfile_path` text NOT NULL,
	`build_context` text NOT NULL,
	`internal_port` integer NOT NULL,
	`health_check_path` text,
	`auto_deploy` integer DEFAULT false NOT NULL,
	`deployments_approved` integer DEFAULT false NOT NULL,
	`encrypted_repository_token` text,
	`deletion_requested_at` text,
	`current_deployment_id` text,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`current_deployment_id`) REFERENCES `deployments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE INDEX `projects_repository_full_name_idx` ON `projects` (`repository_full_name`);--> statement-breakpoint
CREATE INDEX `projects_name_idx` ON `projects` (`name`);--> statement-breakpoint
CREATE TABLE `runtime_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`deployment_id` text,
	`stream` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runtime_logs_project_id_idx` ON `runtime_logs` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `runtime_logs_created_idx` ON `runtime_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `system_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`project_id` text NOT NULL,
	`trigger` text NOT NULL,
	`scheduled_for` text,
	`status` text NOT NULL,
	`exit_code` integer,
	`output` text DEFAULT '' NOT NULL,
	`error_message` text,
	`triggered_by_user_id` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`triggered_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `task_executions_task_created_idx` ON `task_executions` (`task_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_executions_task_slot_idx` ON `task_executions` (`task_id`,`scheduled_for`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`command` text NOT NULL,
	`schedule` text,
	`enabled` integer DEFAULT true NOT NULL,
	`timeout_in_seconds` integer NOT NULL,
	`next_run_at` text,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_project_name_idx` ON `tasks` (`project_id`,`name`);--> statement-breakpoint
CREATE INDEX `tasks_next_run_at_idx` ON `tasks` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`role` text DEFAULT 'viewer' NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`repository_full_name` text,
	`ref` text,
	`commit_sha` text,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`deployment_ids` text NOT NULL,
	`received_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_received_idx` ON `webhook_deliveries` (`received_at`);--> statement-breakpoint
CREATE TABLE `worker_heartbeats` (
	`worker_id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`docker_available` integer NOT NULL,
	`docker_version` text
);
