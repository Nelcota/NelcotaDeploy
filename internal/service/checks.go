package service

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/store/dbgen"
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
			job, e := c.DB.Queries.NextCheckJob(ctx, time.Now().Unix())
			if errors.Is(e, sql.ErrNoRows) {
				continue
			}
			if e != nil {
				return e
			}
			id, status, repo, sha, check, attempts := job.DeploymentID, job.DesiredStatus, job.Repository, job.Sha, job.CheckID, job.Attempts
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
	return dbgen.New(tx).QueueCheck(ctx, dbgen.QueueCheckParams{DeploymentID: id, DesiredStatus: status})
}
