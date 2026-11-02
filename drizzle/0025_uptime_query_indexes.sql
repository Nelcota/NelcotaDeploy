CREATE INDEX `uptime_checks_project_checked_idx` ON `uptime_checks` (`project_id`,`checked_at`);--> statement-breakpoint
CREATE INDEX `uptime_states_project_idx` ON `uptime_states` (`project_id`);