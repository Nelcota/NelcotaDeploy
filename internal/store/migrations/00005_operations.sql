-- +goose Up
ALTER TABLE servers ADD COLUMN agent_version TEXT NOT NULL DEFAULT '';
CREATE TABLE maintenance_jobs (
 ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 batch TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('backup','update')),
 target TEXT NOT NULL,
 version TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','waiting','applied','failed','cancelled')),
 created_at INTEGER NOT NULL,
 started_at INTEGER NOT NULL DEFAULT 0,
 finished_at INTEGER NOT NULL DEFAULT 0,
 next_at INTEGER NOT NULL DEFAULT 0,
 error_code TEXT NOT NULL DEFAULT ''
);
CREATE INDEX maintenance_pending ON maintenance_jobs(status,ordinal);
-- +goose Down
DROP TABLE maintenance_jobs;
ALTER TABLE servers DROP COLUMN agent_version;
