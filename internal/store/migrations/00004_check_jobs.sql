-- +goose Up
CREATE TABLE check_jobs (deployment_id TEXT PRIMARY KEY REFERENCES deployments(id) ON DELETE CASCADE, desired_status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0);
-- +goose Down
DROP TABLE check_jobs;
