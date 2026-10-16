package service

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"
)

func TestDBErrorMapping(t *testing.T) {
	c, ctx, a := fixture(t)
	_, e := c.DB.Write.ExecContext(ctx, "INSERT INTO apps(id,name,server_id,repository,config) VALUES('other',?,?,'r','{}')", a.Name, a.ServerID)
	if mapped := dbError(e); !Is(mapped, Conflict) || errors.Unwrap(mapped) != e {
		t.Fatal("unique violation", mapped)
	}
	_, e = c.DB.Write.ExecContext(ctx, "INSERT INTO apps(id,name,server_id,repository,config) VALUES('orphan','orphan','missing','r','{}')")
	if !Is(dbError(e), Conflict) {
		t.Fatal("foreign key violation", e)
	}
	if mapped := dbError(sql.ErrNoRows); !Is(mapped, NotFound) || !errors.Is(mapped, sql.ErrNoRows) {
		t.Fatal(mapped)
	}
	if mapped := dbError(context.Canceled); mapped != context.Canceled {
		t.Fatal(mapped)
	}
	typed := fail(Validation, "Invalid")
	if dbError(typed) != typed {
		t.Fatal("service error rewrapped")
	}
	unexpected := errors.New("disk I/O error")
	var internal *Error
	if mapped := dbError(unexpected); errors.As(mapped, &internal) || !errors.Is(mapped, unexpected) {
		t.Fatal("unexpected failure must stay untyped with its cause", mapped)
	}
}

// API tokens never satisfy the recent second factor, however fresh the
// principal's TwoFactorAt claims to be.
func TestRecentSecondFactorExcludesTokens(t *testing.T) {
	core, ctx, _ := fixture(t)
	auth, e := NewAuth(core, "localhost", "http://localhost:8080")
	if e != nil {
		t.Fatal(e)
	}
	en, e := auth.Bootstrap(ctx, UserInput{Email: "fresh@example.com", Name: "Fresh"})
	if e != nil {
		t.Fatal(e)
	}
	person := Principal{ID: en.UserID, Email: "fresh@example.com", Role: "admin", TwoFactorAt: time.Now().Unix()}
	token := person
	token.Scopes = []string{"settings:write"}
	stale := person
	stale.TwoFactorAt = time.Now().Add(-reauthWindow - time.Minute).Unix()
	for name, p := range map[string]Principal{"token": token, "stale": stale} {
		ctx := WithPrincipal(ctx, p)
		if _, e := auth.BeginTOTP(ctx); !Is(e, Forbidden) {
			t.Fatal(name, "began TOTP setup", e)
		}
		if _, e := auth.BeginRegistration(ctx, RegistrationInput{}); !Is(e, Forbidden) {
			t.Fatal(name, "began passkey registration", e)
		}
		if _, e := auth.CreateToken(ctx, TokenInput{Name: "t", Scopes: []string{"apps:read"}}); !Is(e, Forbidden) {
			t.Fatal(name, "created a token", e)
		}
	}
	if _, e := auth.BeginTOTP(WithPrincipal(ctx, person)); e != nil {
		t.Fatal(e)
	}
}

func TestInviteReturnsServer(t *testing.T) {
	c, ctx, _ := fixture(t)
	inv, e := (&serversService{c}).Invite(ctx, ServerInput{Name: "edge", WireGuardIP: "10.77.0.40"})
	if e != nil {
		t.Fatal(e)
	}
	servers, e := (&serversService{c}).List(ctx)
	if e != nil {
		t.Fatal(e)
	}
	for _, s := range servers {
		if s.ID == inv.ServerID {
			if s != inv.Server {
				t.Fatalf("returned %+v, stored %+v", inv.Server, s)
			}
			return
		}
	}
	t.Fatal("invited server not stored")
}

func TestLocalUpdateNeedsNoPerson(t *testing.T) {
	c, _, _ := fixture(t)
	// Without a release identity the request fails as unavailable, not as unauthenticated.
	if _, e := (&OperationsService{Core: c}).LocalUpdate(context.Background(), "v9.9.9"); !Is(e, Unavailable) {
		t.Fatal(e)
	}
}

func TestUploadBackupWithoutConfiguration(t *testing.T) {
	c, ctx, _ := fixture(t)
	if e := c.UploadBackup(ctx, "missing.nbk", ""); e != nil {
		t.Fatal(e)
	}
}
