CREATE TABLE `project_volumes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mount_path` text NOT NULL,
	`attached` integer DEFAULT true NOT NULL,
	`deletion_requested_at` text,
	`deletion_error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_volumes_project_path_idx` ON `project_volumes` (`project_id`,`mount_path`);