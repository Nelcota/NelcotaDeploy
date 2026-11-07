DROP INDEX `deployments_preview_idx`;--> statement-breakpoint
CREATE INDEX `deployments_preview_created_idx` ON `deployments` (`preview_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `runtime_logs_deployment_id_idx` ON `runtime_logs` (`deployment_id`,`id`);