CREATE TABLE `database_backups` (
	`id` text PRIMARY KEY NOT NULL,
	`database_id` text NOT NULL,
	`status` text NOT NULL,
	`trigger` text NOT NULL,
	`storage_key` text,
	`size_bytes` integer,
	`error_message` text,
	`restored_at` text,
	`restore_error` text,
	`created_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`database_id`) REFERENCES `project_databases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `database_backups_database_created_idx` ON `database_backups` (`database_id`,`created_at`);