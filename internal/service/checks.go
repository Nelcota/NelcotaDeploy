package service

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Check publication is an outbox: GitHub latency never blocks the agent event stream.
func (c *Core) RunChecks(ctx context.Context) error {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tick.C:
			if c.GitHub == nil {
				continue
			}
			var id, status, repo, sha string
			var check, attempts int64
			e := c.DB.Read.QueryRowContext(ctx, "SELECT j.deployment_id,j.desired_status,j.attempts,a.repository,d.sha,d.check_id FROM check_jobs j JOIN deployments d ON d.id=j.deployment_id JOIN apps a ON a.id=d.app_id WHERE j.next_at<=? ORDER BY j.next_at,j.rowid LIMIT 1", time.Now().Unix()).Scan(&id, &status, &attempts, &repo, &sha, &check)
			if errors.Is(e, sql.ErrNoRows) {
				continue
			}
			if e != nil {
				return e
			}
			request, cancel := context.WithTimeout(ctx, 20*time.Second)
			checkID, e := c.GitHub.Check(request, repo, sha, status, check)
			cancel()
			if e != nil {
				delay := time.Second << min(attempts, 6)
				_, _ = c.DB.Write.ExecContext(ctx, "UPDATE check_jobs SET attempts=attempts+1,next_at=? WHERE deployment_id=? AND desired_status=?", time.Now().Add(delay).Unix(), id, status)
				continue
			}
			e = c.mutate(ctx, func(tx *sql.Tx) error {
				if checkID != 0 {
					if _, e := tx.ExecContext(ctx, "UPDATE deployments SET check_id=? WHERE id=?", checkID, id); e != nil {
						return e
					}
				}
				_, e := tx.ExecContext(ctx, "DELETE FROM check_jobs WHERE deployment_id=? AND desired_status=?", id, status)
				return e
			})
			if e != nil {
				return e
			}
		}
	}
}
func queueCheck(ctx context.Context, tx *sql.Tx, id, status string) error {
	_, e := tx.ExecContext(ctx, "INSERT INTO check_jobs(deployment_id,desired_status) VALUES(?,?) ON CONFLICT(deployment_id) DO UPDATE SET desired_status=excluded.desired_status,attempts=0,next_at=0", id, status)
	return e
}
