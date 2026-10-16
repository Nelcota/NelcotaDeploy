package service

import (
	"context"
	"database/sql"
)

// Passkey describes a registered WebAuthn credential without key material.
type Passkey struct {
	ID       string `json:"id"`
	LastUsed int64  `json:"last_used"`
}

// Factors summarizes the current user's sign-in factors for account management.
type Factors struct {
	Passkeys          []Passkey `json:"passkeys"`
	TOTP              bool      `json:"totp"`
	RecoveryRemaining int       `json:"recovery_remaining"`
}

// Factors lists the signed-in user's own passkeys and second-factor state.
// Bearer tokens are rejected: factor management belongs to interactive sessions.
func (a *AuthService) Factors(ctx context.Context) (Factors, error) {
	p, e := require(ctx, false)
	if e != nil {
		return Factors{}, e
	}
	if p.Scopes != nil {
		return Factors{}, fail(Forbidden, "Interactive session required")
	}
	out := Factors{Passkeys: []Passkey{}}
	rows, e := a.Core.DB.Read.QueryContext(ctx, "SELECT id,kind,last_used FROM credentials WHERE user_id=? ORDER BY rowid", p.ID)
	if e != nil {
		return out, dbError(e)
	}
	defer rows.Close()
	for rows.Next() {
		var id, kind string
		var last int64
		if e = rows.Scan(&id, &kind, &last); e != nil {
			return out, dbError(e)
		}
		if kind == "totp" {
			out.TOTP = true
			continue
		}
		out.Passkeys = append(out.Passkeys, Passkey{ID: id, LastUsed: last})
	}
	if e = rows.Err(); e != nil {
		return out, dbError(e)
	}
	e = a.Core.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM recovery_codes WHERE user_id=? AND used_at=0", p.ID).Scan(&out.RecoveryRemaining)
	return out, dbError(e)
}

// RemovePasskey deletes one of the signed-in user's passkeys. It requires recent
// interactive authentication and always keeps at least one passkey, because
// passkeys are the only primary sign-in factor.
func (a *AuthService) RemovePasskey(ctx context.Context, id string) error {
	p, e := freshInteractive(ctx)
	if e != nil {
		return e
	}
	return a.Core.mutate(ctx, func(tx *sql.Tx) error {
		var n int
		if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM credentials WHERE user_id=? AND kind='passkey'", p.ID).Scan(&n); e != nil {
			return e
		}
		r, e := tx.ExecContext(ctx, "DELETE FROM credentials WHERE id=? AND user_id=? AND kind='passkey'", id, p.ID)
		if e != nil {
			return e
		}
		if deleted, _ := r.RowsAffected(); deleted != 1 {
			return fail(NotFound, "Passkey not found")
		}
		if n <= 1 {
			return fail(Conflict, "Keep at least one passkey")
		}
		return a.Core.audit(ctx, tx, "auth.passkey.remove", id)
	})
}
