ALTER TABLE `projects` ADD `compose_file_path` text DEFAULT 'compose.yaml' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `compose_service` text;