package service

import (
	"testing"
	"time"
)

func TestFactorsAndPasskeyRemoval(t *testing.T) {
	c, ctx, _ := fixture(t)
	a := &AuthService{Core: c}
	if _, e := c.DB.Write.ExecContext(ctx, "INSERT INTO users(id,email,name,role,created_at) VALUES('admin','admin@example.com','Admin','admin',0),('other','other@example.com','Other','member',0)"); e != nil {
		t.Fatal(e)
	}
	for _, row := range [][]any{{"pk-1", "admin", "passkey", 100}, {"pk-2", "admin", "passkey", 0}, {"totp-admin", "admin", "totp", 5}, {"pk-other", "other", "passkey", 0}} {
		if _, e := c.DB.Write.ExecContext(ctx, "INSERT INTO credentials(id,user_id,kind,data,last_used) VALUES(?,?,?,'{}',?)", row...); e != nil {
			t.Fatal(e)
		}
	}
	if _, e := c.DB.Write.ExecContext(ctx, "INSERT INTO recovery_codes(user_id,code_hash) VALUES('admin','a'),('admin','b')"); e != nil {
		t.Fatal(e)
	}
	if _, e := c.DB.Write.ExecContext(ctx, "UPDATE recovery_codes SET used_at=1 WHERE code_hash='b'"); e != nil {
		t.Fatal(e)
	}
	f, e := a.Factors(ctx)
	if e != nil || !f.TOTP || len(f.Passkeys) != 2 || f.Passkeys[0] != (Passkey{"pk-1", 100}) || f.RecoveryRemaining != 1 {
		t.Fatal(f, e)
	}
	if _, e := a.Factors(WithPrincipal(ctx, Principal{ID: "admin", Role: "admin", Scopes: []string{"apps:read"}})); !Is(e, Forbidden) {
		t.Fatal("bearer listed factors", e)
	}
	stale := WithPrincipal(ctx, Principal{ID: "admin", Role: "admin", TwoFactorAt: time.Now().Add(-10 * time.Minute).Unix()})
	if e := a.RemovePasskey(stale, "pk-2"); !Is(e, Forbidden) {
		t.Fatal("stale session removed passkey", e)
	}
	fresh := WithPrincipal(ctx, Principal{ID: "admin", Role: "admin", TwoFactorAt: time.Now().Unix()})
	if e := a.RemovePasskey(fresh, "pk-other"); !Is(e, NotFound) {
		t.Fatal("removed another user's passkey", e)
	}
	if e := a.RemovePasskey(fresh, "totp-admin"); !Is(e, NotFound) {
		t.Fatal("removed TOTP as a passkey", e)
	}
	if e := a.RemovePasskey(fresh, "pk-2"); e != nil {
		t.Fatal(e)
	}
	if e := a.RemovePasskey(fresh, "pk-1"); !Is(e, Conflict) {
		t.Fatal("removed last passkey", e)
	}
	var audited int
	if e := c.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM audit_log WHERE action='auth.passkey.remove' AND target='pk-2'").Scan(&audited); e != nil || audited != 1 {
		t.Fatal(audited, e)
	}
	f, _ = a.Factors(ctx)
	if len(f.Passkeys) != 1 || f.Passkeys[0].ID != "pk-1" {
		t.Fatal(f)
	}
}
