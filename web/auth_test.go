package web_test

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestLoginPage(t *testing.T) {
	e := newEnv(t)
	res := e.anon("/login?next=%2Fservers&notice=signed-out")
	if res.code != http.StatusOK {
		t.Fatal(res.code)
	}
	mustContain(t, res.body, `data-auth="login"`, `data-next="/servers"`, `autocomplete="username webauthn"`, "Sign in with passkey", `autocomplete="one-time-code"`, "Use a recovery code", "Continue as development administrator", "You have been signed out.", `href="/enroll"`)
	// Open redirects and reflected notices are refused.
	for _, next := range []string{"//evil.example", "https://evil.example", `/\evil`} {
		res = e.anon("/login?next=" + url.QueryEscape(next))
		mustContain(t, res.body, `data-next="/"`)
	}
	res = e.anon("/login?notice=" + url.QueryEscape("<script>x</script>"))
	mustNotContain(t, res.body, "<script>x</script>", "&lt;script&gt;x")
	// Signed-in users skip the form.
	res = e.admin().get("/login?next=%2Fsettings")
	if res.code != http.StatusSeeOther || res.header.Get("Location") != "/settings" {
		t.Fatal(res.code, res.header.Get("Location"))
	}
}

func TestEnrollPage(t *testing.T) {
	e := newEnv(t)
	res := e.anon("/enroll")
	if res.code != http.StatusOK {
		t.Fatal(res.code)
	}
	mustContain(t, res.body, `data-auth="enroll"`, `id="token"`, `type="password"`, "Create passkey", `id="enroll-done"`)
}

func TestAccountPage(t *testing.T) {
	e := newEnv(t)
	if _, err := e.core.DB.Write.ExecContext(e.ctx, "INSERT INTO credentials(id,user_id,kind,data,last_used) VALUES('cred-a','development-user','passkey','{}',?),('cred-b','development-user','passkey','{}',0)", time.Now().Unix()-120); err != nil {
		t.Fatal(err)
	}
	res := e.admin().get("/settings")
	if res.code != http.StatusOK {
		t.Fatal(res.code)
	}
	mustContain(t, res.body, "data-theme-select", "Preferences", `aria-label="Language"`, `href="/settings?lang=pt-BR"`, "Passkey 1", "Passkey 2", "Last used 2 min ago", "Add passkey", `id="remove-passkey-0"`, "Set up authenticator", "API tokens", "Create token", `href="/settings/users"`, `aria-current="page"`)
	member := e.member().get("/settings")
	mustContain(t, member.body, "No passkeys are registered.")
	mustNotContain(t, member.body, "Create token", `href="/settings/users"`, `href="/settings/audit"`)
}

func TestRemovePasskeyAndReauth(t *testing.T) {
	e := newEnv(t)
	if _, err := e.core.DB.Write.ExecContext(e.ctx, "INSERT INTO credentials(id,user_id,kind,data) VALUES('cred-a','development-user','passkey','{}'),('cred-b','development-user','passkey','{}')"); err != nil {
		t.Fatal(err)
	}
	s := e.admin()
	res := s.post("/ui/account/passkeys/cred-b/delete", nil)
	if res.code != http.StatusOK || toast(res.body) != "success" {
		t.Fatal(res.code, res.body)
	}
	mustContain(t, res.body, `elements <section id="passkeys"`, "Passkey removed.")
	mustNotContain(t, res.body, "remove-passkey-1")
	// Last passkey is protected by the service.
	res = s.post("/ui/account/passkeys/cred-a/delete", nil)
	if toast(res.body) != "danger" {
		t.Fatal(res.body)
	}
	mustContain(t, res.body, "Keep at least one passkey")
	// A stale session gets the re-authentication dialog instead of an error toast.
	if _, err := e.core.DB.Write.ExecContext(e.ctx, "UPDATE sessions SET two_factor_at=?", time.Now().Add(-time.Hour).Unix()); err != nil {
		t.Fatal(err)
	}
	res = s.post("/ui/account/passkeys/cred-a/delete", nil)
	mustContain(t, res.body, "event: datastar-patch-signals", `"_reauth":true`)
}

func TestTOTPSetupFlow(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	res := s.post("/ui/account/totp/begin", nil)
	mustContain(t, res.body, `elements <section id="totp-panel"`, `src="data:image/png;base64,`, `id="totp-secret"`, `name="id"`, "Enable two-factor")
	mustNotContain(t, res.body, "otpauth://")
	res = s.post("/ui/account/totp/finish", url.Values{"id": {"bogus"}, "code": {"000000"}})
	if toast(res.body) != "danger" {
		t.Fatal(res.body)
	}
	if strings.Contains(res.body, "location.assign") {
		t.Fatal("redirected after failure")
	}
}

func TestRecoveryCodesRequireTOTP(t *testing.T) {
	e := newEnv(t)
	res := e.admin().post("/ui/account/recovery-codes", nil)
	if toast(res.body) != "danger" {
		t.Fatal(res.body)
	}
	mustContain(t, res.body, "Configure TOTP before generating recovery codes")
}

func TestTokens(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	res := s.post("/ui/account/tokens", url.Values{"name": {"ci"}, "ttl_hours": {"2"}, "scope": {"apps:read", "deploys:write"}})
	mustContain(t, res.body, `elements <section id="tokens"`, `elements <div id="token-created"`, "Copy the token ci now", "apps:read, deploys:write")
	if toast(res.body) == "danger" {
		t.Fatal(res.body)
	}
	page := s.get("/settings")
	mustContain(t, page.body, ">ci<", "revoke-")
	// Members cannot create tokens; the service rejects it.
	res = e.member().post("/ui/account/tokens", url.Values{"name": {"x"}, "ttl_hours": {"1"}, "scope": {"apps:read"}})
	if toast(res.body) != "danger" {
		t.Fatal(res.body)
	}
	// Revoke the created token.
	tokens, err := e.auth.Tokens(withUser(e, "development-user"))
	if err != nil || len(tokens) != 1 {
		t.Fatal(tokens, err)
	}
	res = s.post("/ui/account/tokens/"+tokens[0].ID+"/revoke", nil)
	if toast(res.body) != "success" {
		t.Fatal(res.body)
	}
	mustContain(t, res.body, "No active tokens.")
}
