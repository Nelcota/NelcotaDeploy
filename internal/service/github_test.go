package service

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestGitHubInstallationAndChecks(t *testing.T) {
	c, ctx, app := fixture(t)
	private, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	key := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(private)})
	for k, v := range map[string]string{"github.app_id": "123", "github.private_key": string(key)} {
		if e = (&settingsService{c}).Set(ctx, k, v); e != nil {
			t.Fatal(e)
		}
	}
	app.Config.InstallationID = 42
	if _, e = (&appsService{c}).Update(ctx, app.ID, AppInput{Name: app.Name, ServerID: app.ServerID, Repository: app.Repository, Branch: app.Branch, Config: app.Config}); e != nil {
		t.Fatal(e)
	}
	tokens, checks := 0, 0
	g := &GitHubService{Core: c, Transport: roundTripperFunc(func(r *http.Request) (*http.Response, error) {
		if e := r.Context().Err(); e != nil {
			return nil, e
		}
		var body string
		switch r.URL.Path {
		case "/app/installations/42/access_tokens":
			tokens++
			if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
				t.Fatal("missing app JWT")
			}
			body = fmt.Sprintf(`{"token":"fake-install-token","expires_at":%q}`, time.Now().Add(time.Hour).Format(time.RFC3339))
		case "/repos/example/app/check-runs", "/repos/example/app/check-runs/7":
			checks++
			if !strings.Contains(r.Header.Get("Authorization"), "fake-install-token") {
				t.Fatal("missing installation token")
			}
			var in map[string]any
			if e := json.NewDecoder(r.Body).Decode(&in); e != nil {
				t.Fatal(e)
			}
			if checks == 2 && (r.Method != "PATCH" || in["conclusion"] != "success" || in["status"] != "completed") {
				t.Fatal(r.Method, in)
			}
			body = `{"id":7}`
		default:
			t.Fatalf("unexpected GitHub path: %s", r.URL.Path)
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})}
	for _, status := range []string{"building", "success"} {
		id := int64(0)
		if status == "success" {
			id = 7
		}
		got, e := g.Check(ctx, app.Repository, strings.Repeat("a", 40), status, id)
		if e != nil || got != 7 {
			t.Fatal(got, e)
		}
	}
	if tokens != 1 || checks != 2 {
		t.Fatal(tokens, checks)
	}
	if e := (&settingsService{c}).Set(ctx, "github.app_id", "124"); e != nil {
		t.Fatal(e)
	}
	if _, e := g.Token(ctx, 42); e != nil {
		t.Fatal(e)
	}
	if tokens != 2 {
		t.Fatal("credential rotation reused an old installation transport", tokens)
	}
}
