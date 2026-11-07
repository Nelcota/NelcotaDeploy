ALTER TABLE `projects` ADD `parent_project_id` text REFERENCES projects(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `projects` ADD `environment_name` text;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_parent_environment_idx` ON `projects` (`parent_project_id`,`environment_name`);