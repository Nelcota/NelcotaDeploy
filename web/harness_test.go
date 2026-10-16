package web_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"html"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/events"
	"github.com/Nelcota/NelcotaDeploy/internal/httpapi"
	"github.com/Nelcota/NelcotaDeploy/internal/security"
	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/Nelcota/NelcotaDeploy/internal/store"
	"go.uber.org/goleak"
)

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

const origin = "http://localhost:8080"

// env runs the real HTTP stack (sessions, CSRF, audit) over real services and a
// temporary SQLite database seeded with development data.
type env struct {
	t    *testing.T
	core *service.Core
	auth *service.AuthService
	h    http.Handler
	ctx  context.Context
}

// newEnv runs with simulated GitHub access (DevRepos), like development mode.
func newEnv(t *testing.T) *env {
	t.Helper()
	return newEnvWith(t, func(s *service.Services) { s.Repos = service.DevRepos{} })
}

// newEnvWithout runs without GitHub access.
func newEnvWithout(t *testing.T) *env {
	t.Helper()
	return newEnvWith(t, func(*service.Services) {})
}

func newEnvWith(t *testing.T, configure func(*service.Services)) *env {
	t.Helper()
	ctx := context.Background()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "panel.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	vault, _ := security.NewVault(make([]byte, 32))
	logs, err := events.NewLogStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	core := &service.Core{DB: db, Vault: vault, Hub: events.NewHub(), LogStore: logs}
	// Operation hooks are stubs; no runner starts, so jobs stay queued.
	core.Operations = &service.OperationsService{Core: core, Version: "v1.2.3",
		CreateBackup:  func(context.Context, string) error { return nil },
		VerifyRelease: func(context.Context, string) error { return nil },
		QueuePanel:    func(string, string) error { return nil }}
	if err := core.Seed(ctx); err != nil {
		t.Fatal(err)
	}
	auth, err := service.NewAuth(core, "localhost", origin)
	if err != nil {
		t.Fatal(err)
	}
	services := core.Services(auth)
	services.Notifications = service.NewNotifier(core, origin).Service()
	services.Provisioning = &service.Provisioner{Core: core, Origin: origin}
	configure(&services)
	h := httpapi.New(httpapi.Config{Origin: origin, Dev: true, CSRFKey: bytes.Repeat([]byte{7}, 32), Services: services, DevelopmentLogin: auth.DevelopmentSession, Version: "v1.2.3"})
	return &env{t: t, core: core, auth: auth, h: h, ctx: ctx}
}

// session is a signed-in browser.
type session struct {
	e      *env
	cookie *http.Cookie
	csrf   string
}

// admin signs in as the seeded development administrator.
func (e *env) admin() *session {
	e.t.Helper()
	res, err := e.auth.DevelopmentSession(e.ctx)
	if err != nil {
		e.t.Fatal(err)
	}
	return e.session(res.Token)
}

// member creates a member account with a fresh interactive session.
func (e *env) member() *session {
	e.t.Helper()
	token := security.Token()
	_, err := e.core.DB.Write.ExecContext(e.ctx, "INSERT INTO users(id,email,name,role,created_at) VALUES('member-user','member@example.com','Member','member',0) ON CONFLICT DO NOTHING")
	if err != nil {
		e.t.Fatal(err)
	}
	_, err = e.core.DB.Write.ExecContext(e.ctx, "INSERT INTO sessions(token_hash,user_id,expires_at,two_factor_at) VALUES(?,?,?,?)", security.Hash(token), "member-user", time.Now().Add(time.Hour).Unix(), time.Now().Unix())
	if err != nil {
		e.t.Fatal(err)
	}
	return e.session(token)
}

func (e *env) session(token string) *session {
	s := &session{e: e, cookie: &http.Cookie{Name: "nelcota_dev", Value: token}}
	res := s.get("/api/session")
	var body struct {
		CSRF string `json:"csrf_token"`
	}
	if err := json.Unmarshal([]byte(res.body), &body); err != nil || body.CSRF == "" {
		e.t.Fatal("session", res.code, res.body)
	}
	s.csrf = body.CSRF
	return s
}

type response struct {
	code   int
	header http.Header
	body   string
}

func (e *env) do(r *http.Request) response {
	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, r)
	return response{w.Code, w.Header(), w.Body.String()}
}

// anon performs an unauthenticated GET.
func (e *env) anon(path string) response {
	return e.do(httptest.NewRequest("GET", path, nil))
}

func (s *session) get(path string) response {
	r := httptest.NewRequest("GET", path, nil)
	if s.cookie != nil {
		r.AddCookie(s.cookie)
	}
	return s.e.do(r)
}

// post submits a Datastar form action with Origin and CSRF headers.
func (s *session) post(path string, form url.Values) response {
	return s.postWith(path, form, s.csrf)
}

func (s *session) postWith(path string, form url.Values, csrf string) response {
	r := httptest.NewRequest("POST", path, strings.NewReader(form.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.Header.Set("Origin", origin)
	r.Header.Set("Datastar-Request", "true")
	if csrf != "" {
		r.Header.Set("X-CSRF-Token", csrf)
	}
	r.AddCookie(s.cookie)
	return s.e.do(r)
}

// events parses a Datastar SSE body into (event, data) pairs.
func sseEvents(body string) [][2]string {
	var out [][2]string
	var event string
	var data []string
	sc := bufio.NewScanner(strings.NewReader(body))
	sc.Buffer(make([]byte, 1<<20), 1<<22)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			event = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			data = append(data, strings.TrimPrefix(line, "data: "))
		case line == "" && event != "":
			out = append(out, [2]string{event, strings.Join(data, "\n")})
			event, data = "", nil
		}
	}
	return out
}

// toast returns the first toast message tone in an action response, or "".
func toast(body string) string {
	for _, ev := range sseEvents(body) {
		if strings.Contains(ev[1], "selector #toaster") {
			for _, tone := range []string{"danger", "info"} {
				if strings.Contains(ev[1], `data-tone="`+tone+`"`) {
					return tone
				}
			}
			return "success"
		}
	}
	return ""
}

// mustContain checks markup or its text: an expected string matches either the
// raw body or the body with HTML character references decoded (templ escapes
// apostrophes in text as &#39;).
func mustContain(t *testing.T, body string, want ...string) {
	t.Helper()
	text := html.UnescapeString(body)
	for _, w := range want {
		if !strings.Contains(body, w) && !strings.Contains(text, w) {
			t.Fatalf("missing %q in:\n%s", w, trim(body))
		}
	}
}

func mustNotContain(t *testing.T, body string, unwanted ...string) {
	t.Helper()
	for _, w := range unwanted {
		if strings.Contains(body, w) {
			t.Fatalf("unexpected %q in:\n%s", w, trim(body))
		}
	}
}

func trim(s string) string {
	if len(s) > 3000 {
		return s[:3000] + "…"
	}
	return s
}

// withUser returns a service context for a user with a fresh interactive session.
func withUser(e *env, id string) context.Context {
	return service.WithPrincipal(e.ctx, service.Principal{ID: id, Role: "admin", TwoFactorAt: time.Now().Unix()})
}

// liveRecorder is a concurrency-safe streaming ResponseWriter.
type liveRecorder struct {
	mu     sync.Mutex
	header http.Header
	buf    strings.Builder
	code   int
}

func (l *liveRecorder) Header() http.Header { return l.header }
func (l *liveRecorder) WriteHeader(code int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.code = code
}
func (l *liveRecorder) Write(b []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.Write(b)
}
func (l *liveRecorder) Flush() {}
func (l *liveRecorder) body() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.String()
}

// open starts a stream request and returns a reader plus a stop function that
// cancels the request and waits for the handler to return.
func (s *session) open(path string) (*liveRecorder, func()) {
	ctx, cancel := context.WithCancel(s.e.ctx)
	r := httptest.NewRequest("GET", path, nil).WithContext(ctx)
	r.Header.Set("Datastar-Request", "true")
	r.AddCookie(s.cookie)
	w := &liveRecorder{header: http.Header{}}
	done := make(chan struct{})
	go func() { s.e.h.ServeHTTP(w, r); close(done) }()
	return w, func() { cancel(); <-done }
}

// waitFor polls a stream body until it contains want.
func waitFor(t *testing.T, w *liveRecorder, want string) string {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if b := w.body(); strings.Contains(b, want) {
			return b
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("stream never contained %q:\n%s", want, trim(w.body()))
	return ""
}
