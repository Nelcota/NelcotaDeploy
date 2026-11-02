CREATE TABLE `console_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text,
	`command` text NOT NULL,
	`status` text NOT NULL,
	`exit_code` integer,
	`output` text DEFAULT '' NOT NULL,
	`error_message` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `console_commands_project_user_created_idx` ON `console_commands` (`project_id`,`user_id`,`created_at`);