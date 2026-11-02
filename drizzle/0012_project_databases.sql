CREATE TABLE `project_databases` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`engine` text NOT NULL,
	`image_tag` text NOT NULL,
	`environment_key` text NOT NULL,
	`encrypted_password` text NOT NULL,
	`status` text NOT NULL,
	`error_message` text,
	`deletion_requested_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_databases_project_key_idx` ON `project_databases` (`project_id`,`environment_key`);