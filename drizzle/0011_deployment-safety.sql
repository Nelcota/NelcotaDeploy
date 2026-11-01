ALTER TABLE `deployments` ADD `repository_url` text;--> statement-breakpoint
ALTER TABLE `deployments` ADD `internal_port` integer;--> statement-breakpoint
ALTER TABLE `deployments` ADD `encrypted_secret_values` text;--> statement-breakpoint
UPDATE `deployments`
SET `repository_url` = (SELECT `repository_url` FROM `projects` WHERE `projects`.`id` = `deployments`.`project_id`)
WHERE `status` IN ('queued', 'cloning', 'building', 'starting', 'health_checking');
