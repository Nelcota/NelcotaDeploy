package service

import (
	"context"
	"database/sql"
	"github.com/nelcota/nelcota-deploy/internal/transport"
	"github.com/nelcota/nelcota-deploy/internal/updater"
	"time"
)

// PrepareAgentUpdate is private mTLS control: an agent can only pause and update
// itself. Reserving the writer slot atomically prevents a new deployment claim.
func (c *Core) PrepareAgentUpdate(ctx context.Context, peer transport.Peer, r updater.Request) error {
	if !updater.ValidRequest(r) {
		return fail(Validation, "Atualização inválida")
	}
	return c.mutate(ctx, func(tx *sql.Tx) error {
		var current string
		if e := tx.QueryRowContext(ctx, "SELECT agent_version FROM servers WHERE id=? AND (fingerprint=? OR (previous_fingerprint=? AND previous_cert_until>?))", peer.ID, peer.Fingerprint, peer.Fingerprint, time.Now().Unix()).Scan(&current); e != nil {
			return fail(Forbidden, "Agent não cadastrado")
		}
		var same int
		if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM maintenance_jobs WHERE id=? AND target=? AND version=? AND status IN ('queued','waiting','applied')", r.ID, peer.ID, r.Version).Scan(&same); e != nil {
			return e
		}
		if same == 1 {
			return nil
		}
		if !updater.Newer(r.Version, current) {
			return fail(Validation, "Versão deve ser posterior à instalada")
		}
		var busy int
		if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM maintenance_jobs WHERE kind='update' AND status IN ('queued','waiting')").Scan(&busy); e != nil {
			return e
		}
		if busy > 0 {
			return transport.ErrAgentBusy
		}
		o := Operation{ID: r.ID, Batch: r.ID, Kind: "update", Target: peer.ID, Version: r.Version, Status: "queued", CreatedAt: time.Now().Unix()}
		if e := insertOperation(ctx, tx, o); e != nil {
			return e
		}
		return c.audit(systemContext(ctx), tx, "agent.update.request", r.ID)
	})
}
