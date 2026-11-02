CREATE TABLE `health_alerts` (
	`key` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`text` text NOT NULL,
	`opened_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `container_snapshots_deployment_id_idx` ON `container_snapshots` (`deployment_id`);