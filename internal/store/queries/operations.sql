-- name: ListOperations :many
SELECT id, batch, kind, target, version, status, created_at, started_at, finished_at, error_code
FROM maintenance_jobs
ORDER BY ordinal DESC
LIMIT 100;

-- name: NextOperation :one
-- A waiting operation is resumed before the next queued one starts.
SELECT id, batch, kind, target, version, status, created_at, started_at
FROM maintenance_jobs
WHERE status IN ('queued', 'waiting')
ORDER BY CASE WHEN status = 'waiting' THEN 0 ELSE 1 END, ordinal
LIMIT 1;

-- name: CountPendingOperations :one
SELECT count(*) FROM maintenance_jobs WHERE kind = ? AND status IN ('queued', 'waiting');

-- name: InsertOperation :exec
INSERT INTO maintenance_jobs (id, batch, kind, target, version, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?);

-- name: WaitingAgentUpdate :one
SELECT id, batch, target, version, started_at
FROM maintenance_jobs
WHERE id = ? AND target = ? AND status = 'waiting' AND kind = 'update';
