package service

import (
	"testing"
	"time"
)

func TestTokenScopesAndRevocation(t *testing.T) {
	c, ctx, app := fixture(t)
	auth, e := NewAuth(c, "localhost", "http://localhost:8080")
	if e != nil {
		t.Fatal(e)
	}
	en, e := auth.Bootstrap(ctx, UserInput{Email: "token@example.com", Name: "Token"})
	if e != nil {
		t.Fatal(e)
	}
	admin := WithPrincipal(ctx, Principal{ID: en.UserID, Role: "admin", TwoFactorAt: time.Now().Unix()})
	token, e := auth.CreateToken(admin, TokenInput{Name: "readonly", Scopes: []string{"apps:read", "logs:read"}})
	if e != nil {
		t.Fatal(e)
	}
	p, e := auth.AuthenticateToken(ctx, token.Token)
	if e != nil {
		t.Fatal(e)
	}
	scoped := WithPrincipal(ctx, p)
	if _, e = (&appsService{c}).List(scoped); e != nil {
		t.Fatal(e)
	}
	if e = (&appsService{c}).SetEnvironment(scoped, app.ID, []EnvInput{{Key: "X", Value: "changed"}}); !Is(e, Forbidden) {
		t.Fatal("scoped token mutated env", e)
	}
	if _, e = auth.CreateToken(scoped, TokenInput{Name: "escalation", Scopes: []string{"settings:write"}}); !Is(e, Forbidden) {
		t.Fatal("scoped token minted another token", e)
	}
	list, e := auth.Tokens(admin)
	if e != nil || len(list) != 1 || list[0].Token != "" {
		t.Fatal(list, e)
	}
	if e = auth.RevokeToken(admin, token.ID); e != nil {
		t.Fatal(e)
	}
	if _, e = auth.AuthenticateToken(ctx, token.Token); !Is(e, Unauthenticated) {
		t.Fatal("revoked token accepted", e)
	}
}
