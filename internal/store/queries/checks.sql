-- name: NextCheckJob :one
SELECT j.deployment_id, j.desired_status, j.attempts, a.repository, d.sha, d.check_id
FROM check_jobs j
JOIN deployments d ON d.id = j.deployment_id
JOIN apps a ON a.id = d.app_id
WHERE j.next_at <= ?
ORDER BY j.next_at, j.rowid
LIMIT 1;

-- name: QueueCheck :exec
-- A newer status replaces a pending one and retries from the start.
INSERT INTO check_jobs (deployment_id, desired_status) VALUES (?, ?)
ON CONFLICT (deployment_id) DO UPDATE SET desired_status = excluded.desired_status, attempts = 0, next_at = 0;
