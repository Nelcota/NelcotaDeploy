CREATE TABLE `user_avatar` (
	`user_id` text PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`content` blob NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
