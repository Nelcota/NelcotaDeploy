package service

import (
	"context"
	"log/slog"
	"strings"
	"time"
)

// Removing an app and deleting files cannot share a database transaction. A
// durable outbox makes cleanup retryable after an I/O error or process crash.
func (c *Core) RunLogCleanup(ctx context.Context) error {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	reported := false
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
			if err := c.cleanupLogs(ctx); err != nil && ctx.Err() == nil {
				if !reported {
					slog.Warn("limpeza de logs locais pendente; nova tentativa automática")
					reported = true
				}
			} else {
				reported = false
			}
		}
	}
}

func (c *Core) cleanupLogs(ctx context.Context) error {
	rows, err := c.DB.Read.QueryContext(ctx, "SELECT deployment_id FROM log_cleanup ORDER BY rowid LIMIT 100")
	if err != nil {
		return err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	c.deployLogMu.Lock()
	defer c.deployLogMu.Unlock()
	removed := []any{}
	var failed error
	for _, id := range ids {
		if err := c.LogStore.Remove(ctx, id); err != nil {
			failed = err
			continue
		}
		removed = append(removed, id)
	}
	if len(removed) > 0 {
		query := "DELETE FROM log_cleanup WHERE deployment_id IN (" + strings.TrimSuffix(strings.Repeat("?,", len(removed)), ",") + ")"
		if _, err := c.DB.Write.ExecContext(ctx, query, removed...); err != nil {
			return err
		}
	}
	return failed
}
