CREATE TABLE `previews` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`pull_request_number` integer NOT NULL,
	`branch` text NOT NULL,
	`head_sha` text NOT NULL,
	`status` text NOT NULL,
	`current_deployment_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_deployment_id`) REFERENCES `deployments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `previews_project_number_idx` ON `previews` (`project_id`,`pull_request_number`);--> statement-breakpoint
ALTER TABLE `deployments` ADD `preview_id` text REFERENCES previews(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `deployments_preview_idx` ON `deployments` (`preview_id`);--> statement-breakpoint
ALTER TABLE `environment_variables` ADD `exclude_from_previews` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `previews_enabled` integer DEFAULT false NOT NULL;