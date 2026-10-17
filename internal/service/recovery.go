package service

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base32"
	"github.com/Nelcota/NelcotaDeploy/internal/security"
	"strings"
	"time"
)

// reauthWindow is how recently a person must have completed a second factor
// before sensitive changes.
const reauthWindow = 5 * time.Minute

// freshInteractive requires a person, never an API token, who completed a
// second factor within reauthWindow.
func freshInteractive(ctx context.Context, admin bool) (Principal, error) {
	p, e := require(ctx, admin)
	if e != nil {
		return p, e
	}
	if p.Scopes != nil || time.Now().Unix()-p.TwoFactorAt > int64(reauthWindow/time.Second) {
		return p, fail(Forbidden, "Interactive reauthentication required")
	}
	return p, nil
}

// Recovery codes replace only TOTP: a valid passkey ceremony is still required.
func (a *AuthService) RecoveryCodes(ctx context.Context) ([]string, error) {
	p, e := freshInteractive(ctx, false)
	if e != nil {
		return nil, e
	}
	codes := make([]string, 10)
	for i := range codes {
		b := make([]byte, 20)
		if _, e = rand.Read(b); e != nil {
			return nil, e
		}
		plain := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b)
		parts := []string{}
		for n := 0; n < len(plain); n += 4 {
			parts = append(parts, plain[n:n+4])
		}
		codes[i] = strings.Join(parts, "-")
	}
	e = a.Core.mutate(ctx, func(tx *sql.Tx) error {
		var n int
		if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM credentials WHERE user_id=? AND kind='totp'", p.ID).Scan(&n); e != nil {
			return e
		}
		if n != 1 {
			return fail(Conflict, "Configure TOTP before generating recovery codes")
		}
		if _, e := tx.ExecContext(ctx, "DELETE FROM recovery_codes WHERE user_id=?", p.ID); e != nil {
			return e
		}
		for _, code := range codes {
			if _, e := tx.ExecContext(ctx, "INSERT INTO recovery_codes(user_id,code_hash) VALUES(?,?)", p.ID, security.Hash(normalizeRecovery(code))); e != nil {
				return e
			}
		}
		return a.Core.audit(ctx, tx, "auth.recovery.generate", p.ID)
	})
	return codes, e
}
func normalizeRecovery(s string) string {
	return strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(s), "-", ""))
}
func (a *AuthService) VerifyRecovery(ctx context.Context, challenge, code string) (LoginResult, error) {
	var result LoginResult
	e := a.consumeChallenge(ctx, challenge, "two_factor", func(tx *sql.Tx, user string, _ []byte) error {
		normalized := normalizeRecovery(code)
		if len(normalized) != 32 {
			return fail(Unauthenticated, "Invalid recovery code")
		}
		r, e := tx.ExecContext(ctx, "UPDATE recovery_codes SET used_at=? WHERE user_id=? AND code_hash=? AND used_at=0 AND EXISTS(SELECT 1 FROM credentials WHERE user_id=? AND kind='totp')", time.Now().Unix(), user, security.Hash(normalized), user)
		if e != nil {
			return e
		}
		n, _ := r.RowsAffected()
		if n != 1 {
			return fail(Unauthenticated, "Invalid or previously used recovery code")
		}
		if e = a.Core.audit(systemContext(ctx), tx, "auth.recovery.use", user); e != nil {
			return e
		}
		result, e = a.issueSessionTx(ctx, tx, user)
		return e
	})
	if e != nil {
		return LoginResult{}, e
	}
	return result, nil
}
func (a *AuthService) ResetTOTP(ctx context.Context) error {
	p, e := freshInteractive(ctx, false)
	if e != nil {
		return e
	}
	return a.resetTOTP(ctx, p.ID)
}
func (a *AuthService) resetTOTP(ctx context.Context, user string) error {
	return a.Core.mutate(ctx, func(tx *sql.Tx) error {
		for _, query := range []string{"DELETE FROM credentials WHERE user_id=? AND kind='totp'", "DELETE FROM recovery_codes WHERE user_id=?", "DELETE FROM sessions WHERE user_id=?", "DELETE FROM api_tokens WHERE user_id=?", "DELETE FROM challenges WHERE user_id=?"} {
			if _, e := tx.ExecContext(ctx, query, user); e != nil {
				return e
			}
		}
		return a.Core.audit(ctx, tx, "auth.totp.reset", user)
	})
}

// ResetTOTPByEmail is for local offline disaster recovery only. Opening the store
// takes the process lock; possession of the private data directory is required.
func (a *AuthService) ResetTOTPByEmail(ctx context.Context, email string) error {
	u, e := a.Core.DB.Queries.GetUserByEmail(ctx, strings.ToLower(email))
	if e != nil {
		return dbError(e)
	}
	return a.resetTOTP(systemContext(ctx), u.ID)
}
