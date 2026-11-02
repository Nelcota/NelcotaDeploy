ALTER TABLE `deployments` ADD `auto_rolled_back_at` text;--> statement-breakpoint
ALTER TABLE `deployments` ADD `auto_rollback_skipped_at` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `auto_rollback` integer DEFAULT true NOT NULL;