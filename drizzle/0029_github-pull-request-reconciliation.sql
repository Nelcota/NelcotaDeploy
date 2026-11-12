CREATE TABLE `pull_request_reconciliations` (
	`repository_full_name` text NOT NULL,
	`pull_request_number` integer NOT NULL,
	`delivery_id` text NOT NULL,
	`sender_login` text,
	`next_attempt_at` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`observed_state` text,
	`observed_head_sha` text,
	`observed_head_ref` text,
	`observed_head_repository` text,
	`observed_base_ref` text,
	PRIMARY KEY(`repository_full_name`, `pull_request_number`)
);
--> statement-breakpoint
CREATE INDEX `pull_request_reconciliations_due_idx` ON `pull_request_reconciliations` (`next_attempt_at`);