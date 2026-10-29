CREATE TABLE `servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`host` text,
	`port` integer,
	`username` text,
	`host_key_fingerprint` text,
	`public_address` text,
	`accepts_applications` integer DEFAULT true NOT NULL,
	`status` text NOT NULL,
	`status_message` text,
	`docker_version` text,
	`last_seen_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `servers_name_unique` ON `servers` (`name`);--> statement-breakpoint
ALTER TABLE `container_snapshots` ADD `server_id` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
CREATE INDEX `container_snapshots_server_id_idx` ON `container_snapshots` (`server_id`);--> statement-breakpoint
ALTER TABLE `deployments` ADD `server_id` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
CREATE INDEX `deployments_project_server_idx` ON `deployments` (`project_id`,`server_id`);--> statement-breakpoint
ALTER TABLE `metric_samples` ADD `server_id` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
CREATE INDEX `metric_samples_server_created_idx` ON `metric_samples` (`server_id`,`scope`,`created_at`);--> statement-breakpoint
CREATE INDEX `projects_server_id_idx` ON `projects` (`server_id`);--> statement-breakpoint
-- The panel's own host always exists, so every existing project keeps a valid server.
INSERT INTO `servers` (`id`, `name`, `kind`, `accepts_applications`, `status`, `created_at`, `updated_at`) VALUES ('local', 'Servidor do painel', 'local', true, 'pending', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));