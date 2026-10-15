package service

import (
	"bytes"
	"github.com/pquerna/otp/totp"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestRecoverySingleUseRegenerationAndReset(t *testing.T) {
	c, ctx, _ := fixture(t)
	a, e := NewAuth(c, "localhost", "http://localhost:8080")
	if e != nil {
		t.Fatal(e)
	}
	en, e := a.Bootstrap(ctx, UserInput{Email: "recovery@example.com", Name: "Recovery"})
	if e != nil {
		t.Fatal(e)
	}
	p := Principal{ID: en.UserID, Email: "recovery@example.com", Role: "admin", TwoFactorAt: time.Now().Unix()}
	ctx = WithPrincipal(ctx, p)
	setup, e := a.BeginTOTP(ctx)
	if e != nil {
		t.Fatal(e)
	}
	u, _ := url.Parse(setup.URL)
	code, _ := totp.GenerateCode(u.Query().Get("secret"), time.Now())
	if e = a.FinishTOTP(ctx, setup.ID, code); e != nil {
		t.Fatal(e)
	}
	codes, e := a.RecoveryCodes(ctx)
	if e != nil || len(codes) != 10 {
		t.Fatal(e, codes)
	}
	rows, e := c.DB.Read.QueryContext(ctx, "SELECT code_hash FROM recovery_codes WHERE user_id=?", p.ID)
	if e != nil {
		t.Fatal(e)
	}
	for rows.Next() {
		var hash []byte
		if e = rows.Scan(&hash); e != nil {
			t.Fatal(e)
		}
		if bytes.Contains(hash, []byte(strings.Split(codes[0], "-")[0])) {
			t.Fatal("plaintext recovery code persisted")
		}
	}
	_ = rows.Close()
	if _, e = a.VerifyRecovery(ctx, "invalid-challenge", codes[0]); !Is(e, Unauthenticated) {
		t.Fatal("bypassed passkey challenge", e)
	}
	challenge, _ := a.saveChallenge(ctx, p.ID, "two_factor", struct{}{}, time.Minute)
	result, e := a.VerifyRecovery(ctx, challenge, strings.ToLower(codes[0]))
	if e != nil || result.Token == "" {
		t.Fatal(e)
	}
	challenge, _ = a.saveChallenge(ctx, p.ID, "two_factor", struct{}{}, time.Minute)
	if _, e = a.VerifyRecovery(ctx, challenge, codes[0]); !Is(e, Unauthenticated) {
		t.Fatal("code replay", e)
	}
	challenges := make([]string, 2)
	for i := range challenges {
		challenges[i], _ = a.saveChallenge(ctx, p.ID, "two_factor", struct{}{}, time.Minute)
	}
	var wg sync.WaitGroup
	success := make(chan bool, 2)
	for _, challenge := range challenges {
		wg.Go(func() { _, e := a.VerifyRecovery(ctx, challenge, codes[1]); success <- e == nil })
	}
	wg.Wait()
	close(success)
	n := 0
	for v := range success {
		if v {
			n++
		}
	}
	if n != 1 {
		t.Fatal("code concurrent reuse", n)
	}
	if _, e = a.RecoveryCodes(ctx); e != nil {
		t.Fatal(e)
	}
	challenge, _ = a.saveChallenge(ctx, p.ID, "two_factor", struct{}{}, time.Minute)
	if _, e = a.VerifyRecovery(ctx, challenge, codes[2]); !Is(e, Unauthenticated) {
		t.Fatal("old code survived regeneration", e)
	}
	p.Scopes = []string{"users:write"}
	if _, e = a.RecoveryCodes(WithPrincipal(ctx, p)); !Is(e, Forbidden) {
		t.Fatal("token generated recovery codes", e)
	}
	p.Scopes = nil
	if e = a.ResetTOTP(ctx); e != nil {
		t.Fatal(e)
	}
	for _, table := range []string{"sessions", "challenges", "recovery_codes"} {
		var n int
		if e = c.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM "+table+" WHERE user_id=?", p.ID).Scan(&n); e != nil || n != 0 {
			t.Fatal(table, n, e)
		}
	}
	n = 0
	_ = c.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM credentials WHERE user_id=? AND kind='totp'", p.ID).Scan(&n)
	if n != 0 {
		t.Fatal("TOTP was not reset")
	}
}
