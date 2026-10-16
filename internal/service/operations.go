package service

import (
	"context"
	"database/sql"
	"errors"
	"time"

	agentv1 "github.com/Nelcota/NelcotaDeploy/internal/gen/agent/v1"
	"github.com/Nelcota/NelcotaDeploy/internal/security"
	"github.com/Nelcota/NelcotaDeploy/internal/store/dbgen"
	"github.com/Nelcota/NelcotaDeploy/internal/updater"
)

type Operation struct {
	ID         string `json:"id"`
	Batch      string `json:"batch"`
	Kind       string `json:"kind"`
	Target     string `json:"target"`
	Version    string `json:"version"`
	Status     string `json:"status"`
	CreatedAt  int64  `json:"created_at"`
	StartedAt  int64  `json:"started_at"`
	FinishedAt int64  `json:"finished_at"`
	ErrorCode  string `json:"error_code"`
}
type Operations interface {
	List(context.Context) ([]Operation, error)
	Backup(context.Context) (Operation, error)
	Update(context.Context, string) ([]Operation, error)
	Cancel(context.Context, string) error
	Updates(context.Context) (UpdateStatus, error)
	SetAutomaticUpdates(context.Context, bool) error
}
type OperationsService struct {
	Core          *Core
	Version       string
	VerifyRelease func(context.Context, string) error
	CreateBackup  func(context.Context, string) error
	QueuePanel    func(string, string) error
	PanelResult   func() updater.Result
	// LatestRelease reads the release location's unsigned "latest" pointer.
	LatestRelease func(context.Context) (string, error)
	updates       updateState
}

func (s *OperationsService) List(ctx context.Context) ([]Operation, error) {
	if _, e := authorize(ctx, "settings:write", true); e != nil {
		return nil, e
	}
	rows, e := s.Core.DB.Queries.ListOperations(ctx)
	if e != nil {
		return nil, e
	}
	out := make([]Operation, 0, len(rows))
	for _, r := range rows {
		out = append(out, Operation(r))
	}
	return out, nil
}
func (s *OperationsService) Backup(ctx context.Context) (Operation, error) {
	if _, e := freshInteractive(ctx, true); e != nil {
		return Operation{}, e
	}
	if s.CreateBackup == nil {
		return Operation{}, fail(Unavailable, "Backup not configured")
	}
	o := Operation{ID: security.Token(), Kind: "backup", Target: "panel", Status: "queued", CreatedAt: time.Now().Unix()}
	o.Batch = o.ID
	e := s.Core.mutate(ctx, func(tx *sql.Tx) error {
		n, e := dbgen.New(tx).CountPendingOperations(ctx, "backup")
		if e != nil {
			return e
		}
		if n != 0 {
			return fail(Conflict, "Backup already pending")
		}
		if e := insertOperation(ctx, tx, o); e != nil {
			return e
		}
		return s.Core.audit(ctx, tx, "backup.request", o.ID)
	})
	return o, e
}
func insertOperation(ctx context.Context, tx *sql.Tx, o Operation) error {
	return dbgen.New(tx).InsertOperation(ctx, dbgen.InsertOperationParams{ID: o.ID, Batch: o.Batch, Kind: o.Kind, Target: o.Target, Version: o.Version, Status: o.Status, CreatedAt: o.CreatedAt})
}
func (s *OperationsService) Update(ctx context.Context, version string) ([]Operation, error) {
	if _, e := freshInteractive(ctx, true); e != nil {
		return nil, e
	}
	return s.queueUpdate(ctx, version)
}

// LocalUpdate queues an update requested by root on the panel host itself; the
// request file's permissions are its authorization.
func (s *OperationsService) LocalUpdate(ctx context.Context, version string) ([]Operation, error) {
	return s.queueUpdate(systemContext(ctx), version)
}

// queueUpdate verifies a signed release and queues it for every server, then
// the panel. Callers authorize: people through Update, the panel itself for
// automatic updates.
func (s *OperationsService) queueUpdate(ctx context.Context, version string) ([]Operation, error) {
	if s.VerifyRelease == nil || s.QueuePanel == nil {
		return nil, fail(Unavailable, "Release identity not configured")
	}
	if !updater.Newer(version, s.Version) {
		return nil, fail(Validation, "Version must be newer than the installed version")
	}
	check, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if e := s.VerifyRelease(check, version); e != nil {
		return nil, fail(Validation, "Release missing, incompatible, or signature invalid")
	}
	batch := security.Token()
	out := []Operation{}
	e := s.Core.mutate(ctx, func(tx *sql.Tx) error {
		n, e := dbgen.New(tx).CountPendingOperations(ctx, "update")
		if e != nil {
			return e
		}
		if n != 0 {
			return fail(Conflict, "Update already pending")
		}
		rows, e := tx.QueryContext(ctx, "SELECT id,agent_version FROM servers ORDER BY id")
		if e != nil {
			return e
		}
		for rows.Next() {
			var id, current string
			if e = rows.Scan(&id, &current); e != nil {
				_ = rows.Close()
				return e
			}
			if current == version {
				continue
			}
			if current != "" && !updater.Newer(version, current) {
				_ = rows.Close()
				return fail(Conflict, "Agent has a newer version than requested")
			}
			out = append(out, Operation{ID: security.Token(), Batch: batch, Kind: "update", Target: id, Version: version, Status: "queued", CreatedAt: time.Now().Unix()})
		}
		e = rows.Err()
		_ = rows.Close()
		if e != nil {
			return e
		}
		out = append(out, Operation{ID: security.Token(), Batch: batch, Kind: "update", Target: "panel", Version: version, Status: "queued", CreatedAt: time.Now().Unix()})
		for _, o := range out {
			if e = insertOperation(ctx, tx, o); e != nil {
				return e
			}
		}
		return s.Core.audit(ctx, tx, "update.request", batch)
	})
	return out, e
}
func (s *OperationsService) Cancel(ctx context.Context, batch string) error {
	if _, e := freshInteractive(ctx, true); e != nil {
		return e
	}
	return s.Core.mutate(ctx, func(tx *sql.Tx) error {
		var n int
		if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM maintenance_jobs WHERE batch=? AND status='waiting'", batch).Scan(&n); e != nil {
			return e
		}
		if n != 0 {
			return fail(Conflict, "Operation already running")
		}
		r, e := tx.ExecContext(ctx, "UPDATE maintenance_jobs SET status='cancelled',finished_at=? WHERE batch=? AND status='queued'", time.Now().Unix(), batch)
		if e != nil {
			return e
		}
		n64, _ := r.RowsAffected()
		if n64 == 0 {
			return fail(NotFound, "Pending operation not found")
		}
		return s.Core.audit(ctx, tx, "operation.cancel", batch)
	})
}
func (s *OperationsService) Run(ctx context.Context) error {
	// A crashed backup is retryable; updates retain their waiting state until the
	// new version reconnects or the root helper's durable result reports failure.
	if _, e := s.Core.DB.Write.ExecContext(ctx, "UPDATE maintenance_jobs SET status='queued',started_at=0 WHERE kind='backup' AND status='waiting'"); e != nil {
		return e
	}
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	releases := time.NewTicker(updateCheckInterval)
	defer releases.Stop()
	first := time.After(firstUpdateCheck)
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-first:
			s.checkUpdates(ctx)
		case <-releases.C:
			s.checkUpdates(ctx)
		case <-tick.C:
			if e := s.step(ctx); e != nil && ctx.Err() != nil {
				return nil
			}
		}
	}
}
func (s *OperationsService) step(ctx context.Context) error {
	next, e := s.Core.DB.Queries.NextOperation(ctx)
	if errors.Is(e, sql.ErrNoRows) {
		return nil
	}
	if e != nil {
		return e
	}
	o := Operation{ID: next.ID, Batch: next.Batch, Kind: next.Kind, Target: next.Target, Version: next.Version, Status: next.Status, CreatedAt: next.CreatedAt, StartedAt: next.StartedAt}
	if o.Status == "waiting" {
		if o.Target == "panel" {
			if s.Version == o.Version && (s.PanelResult == nil || (s.PanelResult().ID == o.ID && s.PanelResult().Status == "applied")) {
				return s.finish(ctx, o, "applied", "")
			}
			if s.PanelResult != nil {
				r := s.PanelResult()
				if r.ID == o.ID && (r.Status == "failed" || r.Status == "rolled_back") {
					return s.finish(ctx, o, "failed", "update_"+r.Status)
				}
			}
		}
		if time.Now().Unix()-o.StartedAt > 12*60 {
			return s.finish(ctx, o, "failed", "update_timeout")
		}
		return nil
	}
	if o.Kind == "update" {
		// Respect the ordered rollout even if a server is offline; do not skip it.
		if s.Core.Control == nil && o.Target != "panel" {
			return nil
		}
		var next int64
		if e = s.Core.DB.Read.QueryRowContext(ctx, "SELECT next_at FROM maintenance_jobs WHERE id=?", o.ID).Scan(&next); e != nil {
			return e
		}
		if next > time.Now().Unix() {
			return nil
		}
	}
	claimed := false
	e = s.Core.mutate(ctx, func(tx *sql.Tx) error {
		if o.Kind == "update" {
			q := dbgen.New(tx)
			countActive := q.CountActiveDeployments
			if o.Target != "panel" {
				countActive = func(ctx context.Context) (int64, error) { return q.CountServerActiveDeployments(ctx, o.Target) }
				online, e := q.CountOnlineServer(ctx, dbgen.CountOnlineServerParams{ID: o.Target, HeartbeatAt: heartbeatCutoff()})
				if e != nil {
					return e
				}
				if online == 0 {
					return nil
				}
			}
			active, e := countActive(ctx)
			if e != nil {
				return e
			}
			if active > 0 {
				return nil
			}
		}
		r, e := tx.ExecContext(ctx, "UPDATE maintenance_jobs SET status='waiting',started_at=? WHERE id=? AND status='queued'", time.Now().Unix(), o.ID)
		if e != nil {
			return e
		}
		n, _ := r.RowsAffected()
		claimed = n == 1
		return nil
	})
	if e != nil || !claimed {
		return e
	}
	if o.Kind == "backup" {
		if s.CreateBackup == nil {
			return s.finish(ctx, o, "failed", "backup_unavailable")
		}
		run, cancel := context.WithTimeout(ctx, 15*time.Minute)
		defer cancel()
		if e = s.CreateBackup(run, o.ID); e != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return s.finish(ctx, o, "failed", "backup_failed")
		}
		return s.finish(ctx, o, "applied", "")
	}
	if o.Target == "panel" {
		if s.CreateBackup != nil {
			run, cancel := context.WithTimeout(ctx, 15*time.Minute)
			e := s.CreateBackup(run, "pre-update-"+o.ID)
			cancel()
			if e != nil {
				return s.finish(ctx, o, "failed", "pre_update_backup_failed")
			}
		}
		if _, e := s.Core.DB.Write.ExecContext(ctx, "UPDATE maintenance_jobs SET started_at=? WHERE id=? AND status='waiting'", time.Now().Unix(), o.ID); e != nil {
			return e
		}
		if s.QueuePanel == nil || s.QueuePanel(o.ID, o.Version) != nil {
			return s.finish(ctx, o, "failed", "update_unavailable")
		}
		return nil
	}
	if e = s.Core.send(ctx, o.Target, &agentv1.Command{Action: &agentv1.Command_Update{Update: &agentv1.Update{Id: o.ID, Version: o.Version}}}); e != nil {
		return s.finish(ctx, o, "failed", "agent_unavailable")
	}
	return nil
}
func (s *OperationsService) finish(ctx context.Context, o Operation, status, code string) error {
	e := s.Core.mutate(ctx, func(tx *sql.Tx) error {
		if _, e := tx.ExecContext(ctx, "UPDATE maintenance_jobs SET status=?,finished_at=?,error_code=? WHERE id=? AND status='waiting'", status, time.Now().Unix(), code, o.ID); e != nil {
			return e
		}
		if status == "failed" {
			if _, e := tx.ExecContext(ctx, "UPDATE maintenance_jobs SET status='cancelled',finished_at=?,error_code='rollout_stopped' WHERE batch=? AND status='queued'", time.Now().Unix(), o.Batch); e != nil {
				return e
			}
		}
		return s.Core.audit(systemContext(ctx), tx, "operation."+status, o.ID)
	})
	if e == nil && status == "failed" {
		switch o.Kind {
		case "backup":
			s.Core.BackupFailed()
		case "update":
			s.Core.publish("operations", "update.failed", map[string]string{"version": o.Version, "code": code, "target": o.Target})
		}
	}
	return e
}

// BackupFailed announces a failed backup, manual or daily.
func (c *Core) BackupFailed() {
	c.publish("operations", "backup.failed", map[string]string{})
}

// BackupUnverified announces that the weekly test restore of the newest backup failed.
func (c *Core) BackupUnverified() {
	c.publish("operations", "backup.unverified", map[string]string{})
}
func (c *Core) operationResult(ctx context.Context, server string, result *agentv1.OperationResult) error {
	if result == nil || result.Id == "" {
		return nil
	}
	w, e := c.DB.Queries.WaitingAgentUpdate(ctx, dbgen.WaitingAgentUpdateParams{ID: result.Id, Target: server})
	if errors.Is(e, sql.ErrNoRows) {
		return nil
	}
	if e != nil {
		return e
	}
	o := Operation{ID: w.ID, Batch: w.Batch, Kind: "update", Target: w.Target, Version: w.Version, StartedAt: w.StartedAt}
	if result.Status == "applied" {
		var ready int
		e := c.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM servers WHERE id=? AND agent_ready=1 AND agent_version=? AND heartbeat_at>=?", server, o.Version, o.StartedAt).Scan(&ready)
		if e != nil {
			return e
		}
		if ready == 1 {
			return (&OperationsService{Core: c}).finish(ctx, o, "applied", "")
		}
		return nil
	}
	if result.Status == "busy" {
		_, e = c.DB.Write.ExecContext(ctx, "UPDATE maintenance_jobs SET status='queued',started_at=0,next_at=? WHERE id=? AND status='waiting'", time.Now().Add(10*time.Second).Unix(), o.ID)
		return e
	}
	if result.Status == "failed" || result.Status == "rolled_back" {
		return (&OperationsService{Core: c}).finish(ctx, o, "failed", "agent_update_"+result.Status)
	}
	return nil
}
