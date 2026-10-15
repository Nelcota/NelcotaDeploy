package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/nelcota/nelcota-deploy/internal/events"
	"github.com/nelcota/nelcota-deploy/internal/service"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

type authStub struct{ service.Auth }

func (authStub) Session(context.Context, string) (service.Principal, error) {
	return service.Principal{ID: "admin", Role: "admin"}, nil
}
func (authStub) FinishLogin(context.Context, service.FinishInput) (service.LoginResult, error) {
	return service.LoginResult{Token: "opaque-session-token", ExpiresAt: time.Now().Add(time.Hour)}, nil
}
func (authStub) Logout(context.Context, string) error { return nil }
func testAPI() http.Handler {
	return New(Config{Origin: "https://panel.example.com", CSRFKey: bytes.Repeat([]byte{1}, 32), Services: service.Services{Auth: authStub{}}})
}
func TestSessionRequired(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/apps", nil)
	w := httptest.NewRecorder()
	testAPI().ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatal(w.Code)
	}
}
func TestCSRFAndStrictCookie(t *testing.T) {
	h := testAPI()
	r := httptest.NewRequest("POST", "/api/auth/login/finish", bytes.NewBufferString(`{"ceremony_id":"x","credential":{}}`))
	r.Header.Set("Origin", "https://panel.example.com")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].Secure || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode || cookies[0].Name != "__Host-nelcota" {
		t.Fatal(cookies)
	}
	get := httptest.NewRequest("GET", "/api/session", nil)
	get.AddCookie(cookies[0])
	w = httptest.NewRecorder()
	h.ServeHTTP(w, get)
	var session struct {
		CSRF string `json:"csrf_token"`
	}
	if e := json.Unmarshal(w.Body.Bytes(), &session); e != nil {
		t.Fatal(e)
	}
	for _, row := range []struct {
		origin, csrf string
		want         int
	}{{"https://evil.example", session.CSRF, 403}, {"https://panel.example.com", "", 403}, {"https://panel.example.com", session.CSRF, 200}} {
		r = httptest.NewRequest("POST", "/api/auth/logout", nil)
		r.Header.Set("Origin", row.origin)
		r.Header.Set("X-CSRF-Token", row.csrf)
		r.AddCookie(cookies[0])
		w = httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != row.want {
			t.Fatal(row, w.Code)
		}
	}
}
func TestNoDevEndpointInProduction(t *testing.T) {
	r := httptest.NewRequest("POST", "/api/dev/session", bytes.NewBufferString("{}"))
	r.Header.Set("Origin", "https://panel.example.com")
	w := httptest.NewRecorder()
	testAPI().ServeHTTP(w, r)
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
}
func TestJSONRejectsTrailingData(t *testing.T) {
	h := testAPI()
	r := httptest.NewRequest("POST", "/api/auth/login/finish", bytes.NewBufferString(`{} {}`))
	r.Header.Set("Origin", "https://panel.example.com")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
}

type revocableAuth struct {
	service.Auth
	revoked atomic.Bool
	p       service.Principal
}

func (a *revocableAuth) Session(context.Context, string) (service.Principal, error) {
	if a.revoked.Load() {
		return service.Principal{}, errors.New("revoked or expired")
	}
	return a.p, nil
}
func (a *revocableAuth) AuthenticateToken(ctx context.Context, token string) (service.Principal, error) {
	return a.Session(ctx, token)
}

type streamLogs struct {
	service.Logs
	cancelled chan struct{}
}

func (s *streamLogs) Subscribe(context.Context, string) (events.Subscription, error) {
	return events.Subscription{C: make(chan events.Event), Cancel: func() { close(s.cancelled) }}, nil
}

func TestEventStreamClosesWhenCredentialsAreRevoked(t *testing.T) {
	for _, bearer := range []bool{false, true} {
		t.Run(map[bool]string{false: "session", true: "token"}[bearer], func(t *testing.T) {
			auth := &revocableAuth{p: service.Principal{ID: "admin", Role: "admin"}}
			if bearer {
				auth.p.Scopes = []string{"logs:read"}
			}
			logs := &streamLogs{cancelled: make(chan struct{})}
			a := &API{cfg: Config{Services: service.Services{Auth: auth, Logs: logs}}}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				r = r.WithContext(service.WithPrincipal(r.Context(), auth.p))
				a.streamEvents(w, r, 5*time.Millisecond)
			}))
			defer server.Close()
			ctx, cancel := context.WithTimeout(t.Context(), time.Second)
			defer cancel()
			r, _ := http.NewRequestWithContext(ctx, "GET", server.URL, nil)
			if bearer {
				r.Header.Set("Authorization", "Bearer token")
			} else {
				r.AddCookie(&http.Cookie{Name: "__Host-nelcota", Value: "session"})
			}
			res, e := server.Client().Do(r)
			if e != nil {
				t.Fatal(e)
			}
			defer res.Body.Close()
			auth.revoked.Store(true)
			if _, e = io.Copy(io.Discard, res.Body); e != nil {
				t.Fatal("stream did not close after revocation", e)
			}
			select {
			case <-logs.cancelled:
			default:
				t.Fatal("stream subscription leaked")
			}
		})
	}
}
