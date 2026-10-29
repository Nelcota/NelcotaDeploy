CREATE TABLE `github_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`html_url` text NOT NULL,
	`owner_login` text NOT NULL,
	`encrypted_private_key` text NOT NULL,
	`encrypted_webhook_secret` text,
	`created_at` text NOT NULL
);
