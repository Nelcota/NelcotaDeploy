package service

import (
	"context"
	"database/sql"
)

// SetRole changes another user's role. The last administrator cannot be demoted,
// and the user's API tokens are revoked so none outlives the old role.
func (a *AuthService) SetRole(ctx context.Context, id, role string) error {
	p, e := authorize(ctx, "users:write", true)
	if e != nil {
		return e
	}
	if role != "admin" && role != "member" {
		return fail(Validation, "Invalid role")
	}
	if id == p.ID {
		return fail(Conflict, "You can't change your own role")
	}
	return a.Core.mutate(ctx, func(tx *sql.Tx) error {
		var current string
		if e := tx.QueryRowContext(ctx, "SELECT role FROM users WHERE id=?", id).Scan(&current); e != nil {
			return dbError(e)
		}
		if current == role {
			return nil
		}
		if e := lastAdmin(ctx, tx, current); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, "UPDATE users SET role=? WHERE id=?", role, id); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, "DELETE FROM api_tokens WHERE user_id=?", id); e != nil {
			return e
		}
		return a.Core.audit(ctx, tx, "user.role."+role, id)
	})
}

// Remove deletes another user with their passkeys, sessions, tokens, and pending
// challenges. Audit entries keep the user ID.
func (a *AuthService) Remove(ctx context.Context, id string) error {
	p, e := authorize(ctx, "users:write", true)
	if e != nil {
		return e
	}
	if id == p.ID {
		return fail(Conflict, "You can't remove yourself")
	}
	return a.Core.mutate(ctx, func(tx *sql.Tx) error {
		var role string
		if e := tx.QueryRowContext(ctx, "SELECT role FROM users WHERE id=?", id).Scan(&role); e != nil {
			return dbError(e)
		}
		if e := lastAdmin(ctx, tx, role); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, "DELETE FROM challenges WHERE user_id=?", id); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, "DELETE FROM users WHERE id=?", id); e != nil {
			return e
		}
		return a.Core.audit(ctx, tx, "user.remove", id)
	})
}

func lastAdmin(ctx context.Context, tx *sql.Tx, role string) error {
	if role != "admin" {
		return nil
	}
	var n int
	if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM users WHERE role='admin'").Scan(&n); e != nil {
		return e
	}
	if n <= 1 {
		return fail(Conflict, "Keep at least one administrator")
	}
	return nil
}
