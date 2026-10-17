-- name: NextQueuedDeployment :one
-- The oldest queued deployment, manual before push, whose server is connected,
-- ready, not being updated, and below its build limit, and whose app has no
-- deployment in progress.
SELECT d.id
FROM deployments d
JOIN apps a ON a.id = d.app_id
JOIN servers s ON s.id = a.server_id
WHERE d.status = 'queued'
  AND s.status = 'online'
  AND s.agent_ready = 1
  AND s.heartbeat_at > sqlc.arg(heartbeat_after)
  AND NOT EXISTS (
    SELECT 1 FROM maintenance_jobs m
    WHERE m.kind = 'update'
      AND (m.target = s.id OR m.target = 'panel')
      AND (
        m.status = 'waiting'
        OR (m.status = 'queued' AND m.ordinal = (
          SELECT min(ordinal) FROM maintenance_jobs WHERE kind = 'update' AND status IN ('queued', 'waiting')
        ))
      )
  )
  AND NOT EXISTS (SELECT 1 FROM active_deployments x WHERE x.app_id = d.app_id)
  AND (
    SELECT count(*) FROM active_deployments x JOIN apps ax ON ax.id = x.app_id WHERE ax.server_id = s.id
  ) < s.build_limit
ORDER BY CASE WHEN d.origin = 'push' THEN 1 ELSE 0 END, d.queued_at, d.rowid
LIMIT 1;

-- name: StartDeployment :exec
UPDATE deployments SET status = 'building', started_at = ? WHERE id = ? AND status = 'queued';

-- name: FailDispatch :exec
UPDATE deployments SET status = 'failed', error_code = ?, finished_at = ? WHERE id = ? AND status = 'building';

-- name: CancelQueuedDeployments :exec
UPDATE deployments SET status = 'cancelled', finished_at = ? WHERE app_id = ? AND status = 'queued';

-- name: InsertQueuedDeployment :exec
INSERT INTO deployments (id, app_id, sha, message, author, origin, status, queued_at, clean, retry_of)
VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?);

-- name: RequestCancel :exec
-- A queued deployment is cancelled at once; a running one is flagged for the agent.
UPDATE deployments
SET status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
    finished_at = CASE WHEN status = 'queued' THEN sqlc.arg(finished_at) ELSE finished_at END,
    cancel_requested = 1
WHERE id = sqlc.arg(id);

-- name: CountUnfinishedAppDeployments :one
SELECT (SELECT count(*) FROM deployments d WHERE d.app_id = sqlc.arg(app_id) AND d.status = 'queued')
     + (SELECT count(*) FROM active_deployments x WHERE x.app_id = sqlc.arg(app_id));

-- name: CountActiveDeployments :one
SELECT count(*) FROM active_deployments;

-- name: CountServerActiveDeployments :one
SELECT count(*) FROM active_deployments x JOIN apps a ON a.id = x.app_id WHERE a.server_id = ?;

-- name: ListServerActiveDeployments :many
SELECT x.id, x.app_id, x.sha, x.status, x.started_at, x.cancel_requested
FROM active_deployments x
JOIN apps a ON a.id = x.app_id
WHERE a.server_id = ?;

-- name: ListExpiredLogDeployments :many
-- Finished deployments beyond the 50 most recent per app keep no logs.
SELECT id FROM deployments
WHERE app_id = ? AND status IN ('success', 'failed', 'cancelled')
ORDER BY queued_at DESC, rowid DESC
LIMIT -1 OFFSET 50;
