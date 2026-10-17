package service

import (
	"testing"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/security"
)

func TestSetRoleAndRemove(t *testing.T) {
	c, ctx, _ := fixture(t)
	a := &AuthService{Core: c}
	for _, q := range []string{
		"INSERT INTO users(id,email,name,role,created_at) VALUES('admin','a@example.com','A','admin',0),('m','m@example.com','M','member',0)",
		"INSERT INTO api_tokens(id,user_id,name,token_hash,scopes,expires_at,created_at) VALUES('t','m','ci',x'01','[]',9999999999,0)",
		"INSERT INTO credentials(id,user_id,kind,data) VALUES('pk','m','passkey','{}')",
	} {
		if _, e := c.DB.Write.ExecContext(ctx, q); e != nil {
			t.Fatal(e)
		}
	}
	if e := a.SetRole(ctx, "admin", "member"); !Is(e, Conflict) {
		t.Fatal("changed own role", e)
	}
	if e := a.SetRole(ctx, "m", "owner"); !Is(e, Validation) {
		t.Fatal(e)
	}
	if e := a.SetRole(ctx, "m", "admin"); e != nil {
		t.Fatal(e)
	}
	var tokens int
	_ = c.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM api_tokens WHERE user_id='m'").Scan(&tokens)
	if tokens != 0 {
		t.Fatal("tokens kept across role change")
	}
	// Two admins now; demoting one is allowed, demoting the last is not.
	if e := a.SetRole(ctx, "m", "member"); e != nil {
		t.Fatal(e)
	}
	if e := a.Remove(ctx, "admin"); !Is(e, Conflict) {
		t.Fatal("removed self", e)
	}
	if e := a.Remove(WithPrincipal(ctx, Principal{ID: "m", Role: "member"}), "admin"); !Is(e, Forbidden) {
		t.Fatal("member removed a user", e)
	}
	if e := a.Remove(ctx, "m"); e != nil {
		t.Fatal(e)
	}
	var creds, audit int
	_ = c.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM credentials WHERE user_id='m'").Scan(&creds)
	_ = c.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM audit_log WHERE action IN ('user.remove','user.role.admin','user.role.member') AND target='m'").Scan(&audit)
	if creds != 0 || audit != 3 {
		t.Fatal(creds, audit)
	}
	if e := a.Remove(ctx, "m"); !Is(e, NotFound) {
		t.Fatal(e)
	}
	// The only administrator cannot be demoted by another admin either.
	if _, e := c.DB.Write.ExecContext(ctx, "INSERT INTO users(id,email,name,role,created_at) VALUES('b','b@example.com','B','member',0)"); e != nil {
		t.Fatal(e)
	}
	if e := a.SetRole(WithPrincipal(ctx, Principal{ID: "b", Role: "admin"}), "admin", "member"); !Is(e, Conflict) {
		t.Fatal("demoted last admin", e)
	}
}

func TestInvitationsLastADayAndStoreOnlyAHash(t *testing.T) {
	c, ctx, _ := fixture(t)
	a := &AuthService{Core: c}
	en, e := a.Create(ctx, UserInput{Email: "ana@example.com", Name: "Ana", Role: "member"})
	if e != nil {
		t.Fatal(e)
	}
	if left := time.Until(en.ExpiresAt); left < InvitationLifetime-time.Minute || left > InvitationLifetime {
		t.Fatal(left)
	}
	var stored int
	if e := c.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM challenges WHERE purpose='enroll' AND token_hash=?", security.Hash(en.Token)).Scan(&stored); e != nil || stored != 1 {
		t.Fatal(stored, e)
	}
	// The first administrator's installer invitation stays short.
	fresh, ctx2, _ := fixture(t)
	if _, e := fresh.DB.Write.ExecContext(ctx2, "DELETE FROM users"); e != nil {
		t.Fatal(e)
	}
	boot, e := (&AuthService{Core: fresh}).Bootstrap(ctx2, UserInput{Email: "root@example.com", Name: "Root"})
	if e != nil || time.Until(boot.ExpiresAt) > 15*time.Minute {
		t.Fatal(boot.ExpiresAt, e)
	}
}
