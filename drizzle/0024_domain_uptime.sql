CREATE TABLE `uptime_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`hostname` text NOT NULL,
	`up` integer NOT NULL,
	`status_code` integer,
	`response_time_in_ms` integer,
	`error` text,
	`checked_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `uptime_checks_hostname_checked_idx` ON `uptime_checks` (`hostname`,`checked_at`);--> statement-breakpoint
CREATE INDEX `uptime_checks_checked_idx` ON `uptime_checks` (`checked_at`);--> statement-breakpoint
CREATE TABLE `uptime_states` (
	`hostname` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`changed_at` text NOT NULL,
	`certificate_expires_at` text,
	`certificate_checked_at` text,
	`certificate_alerted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
