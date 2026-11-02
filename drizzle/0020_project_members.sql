CREATE TABLE `project_members` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`added_by_user_id` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_members_user_id_idx` ON `project_members` (`user_id`);--> statement-breakpoint
-- Every user saw every project before memberships existed; keep that access, with the same role.
INSERT INTO `project_members` (`project_id`, `user_id`, `role`, `created_at`)
SELECT `projects`.`id`, `user`.`id`, `user`.`role`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `projects` CROSS JOIN `user`
WHERE `user`.`role` IN ('developer', 'viewer') AND `projects`.`parent_project_id` IS NULL;
