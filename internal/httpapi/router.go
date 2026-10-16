package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/Nelcota/NelcotaDeploy/web"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"golang.org/x/time/rate"
)

type Config struct {
	DevelopmentLogin func(context.Context) (service.LoginResult, error)
	Origin           string
	Dev              bool
	CSRFKey          []byte
	Services         service.Services
	GitHub           *service.GitHubService
	Enrollment       *service.EnrollmentService
	AgentScript      []byte
	Version          string
}
type API struct{ cfg Config }

func New(cfg Config) http.Handler {
	a := &API{cfg}
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(a.headers)
	r.Use(newLimiter(5, 30).middleware)
	r.Use(a.session)
	r.Use(a.audit)
	r.Use(a.csrf)
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { write(w, 200, map[string]string{"status": "ok"}) })
	r.Get("/agent.sh", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/x-shellscript")
		_, _ = w.Write(cfg.AgentScript)
	})
	r.Post("/api/webhooks/github", a.githubWebhook)
	r.Get("/api/github/callback", a.githubCallback)
	r.Post("/api/servers/join", a.joinServer)
	r.Route("/api/auth", func(r chi.Router) {
		r.Use(newLimiter(rate.Every(10*time.Second), 8).middleware)
		r.Post("/recovery/verify", a.verifyRecovery)
		r.Post("/register/begin", a.beginRegistration)
		r.Post("/register/finish", a.finishRegistration)
		r.Post("/login/begin", a.beginLogin)
		r.Post("/login/finish", a.finishLogin)
		r.Post("/totp/verify", a.verifyTOTP)
	})
	r.Group(func(r chi.Router) {
		r.Use(a.requireSession)
		r.Get("/api/session", a.currentSession)
		r.Post("/api/auth/logout", a.logout)
		r.Post("/api/auth/recovery-codes", a.recoveryCodes)
		r.Post("/api/auth/totp/reset", a.resetTOTP)
		r.Post("/api/auth/totp/begin", a.beginTOTP)
		r.Post("/api/auth/totp/finish", a.finishTOTP)
		r.Get("/api/apps", a.listApps)
		r.Post("/api/apps", a.createApp)
		r.Get("/api/apps/{id}", a.getApp)
		r.Put("/api/apps/{id}", a.updateApp)
		r.Delete("/api/apps/{id}", a.deleteApp)
		r.Get("/api/apps/{id}/env", a.appEnvironment)
		r.Put("/api/apps/{id}/env", a.setAppEnvironment)
		r.Post("/api/apps/{id}/actions", a.appAction)
		r.Get("/api/apps/{id}/deployments", a.listDeployments)
		r.Post("/api/deployments", a.enqueueDeployment)
		r.Get("/api/deployments/{id}", a.getDeployment)
		r.Post("/api/deployments/{id}/cancel", a.cancelDeployment)
		r.Get("/api/deployments/{id}/logs", a.deploymentLogs)
		r.Get("/api/events", a.sse)
		r.Patch("/api/servers/{id}/limits", a.updateServerLimits)
		r.Get("/api/servers", a.listServers)
		r.Post("/api/servers/invite", a.inviteServer)
		r.Post("/api/servers/{id}/prune", a.pruneServer)
		r.Post("/api/github/manifest", a.githubManifest)
		if cfg.Services.Operations != nil {
			r.Get("/api/operations", a.listOperations)
			r.Post("/api/operations/backup", a.backup)
			r.Post("/api/operations/update", a.update)
			r.Post("/api/operations/{batch}/cancel", a.cancelOperation)
		}
		r.Get("/api/settings", a.getSettings)
		r.Put("/api/settings/{key}", a.setSetting)
		r.Get("/api/audit", a.listAudit)
		r.Get("/api/tokens", a.listTokens)
		r.Post("/api/tokens", a.createToken)
		r.Delete("/api/tokens/{id}", a.revokeToken)
		r.Get("/api/users", a.listUsers)
		r.Put("/api/users/{id}/role", a.setUserRole)
		r.Delete("/api/users/{id}", a.removeUser)
		r.Post("/api/users", a.createUser)
	})
	if cfg.Dev && cfg.DevelopmentLogin != nil {
		r.Post("/api/dev/session", a.devSession)
	}
	web.Register(r, web.Config{
		Services:   cfg.Services,
		Origin:     cfg.Origin,
		Dev:        cfg.Dev,
		DevLogin:   cfg.Dev && cfg.DevelopmentLogin != nil,
		Version:    cfg.Version,
		CSRFToken:  a.requestCSRF,
		Authorized: a.streamAuthorized,
	})
	return r
}
func (a *API) headers(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'none'")
		w.Header().Set("Cache-Control", "no-store")
		if !a.cfg.Dev {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		next.ServeHTTP(w, r)
	})
}
func (a *API) cookieName() string {
	if a.cfg.Dev {
		return "nelcota_dev"
	}
	return "__Host-nelcota"
}
func (a *API) cookie(w http.ResponseWriter, v service.LoginResult) {
	http.SetCookie(w, &http.Cookie{Name: a.cookieName(), Value: v.Token, Path: "/", HttpOnly: true, Secure: !a.cfg.Dev, SameSite: http.SameSiteStrictMode, Expires: v.ExpiresAt, MaxAge: int(time.Until(v.ExpiresAt).Seconds())})
}
func (a *API) session(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r = r.WithContext(service.WithPrincipal(r.Context(), service.Principal{IP: clientIP(r)}))
		if authorization := r.Header.Get("Authorization"); authorization != "" {
			if !strings.HasPrefix(authorization, "Bearer ") || a.cfg.Services.Auth == nil {
				respond(w, nil, &service.Error{Kind: service.Unauthenticated, Message: "Invalid token"})
				return
			}
			p, e := a.cfg.Services.Auth.AuthenticateToken(r.Context(), strings.TrimPrefix(authorization, "Bearer "))
			if e != nil {
				respond(w, nil, e)
				return
			}
			p.IP = clientIP(r)
			r = r.WithContext(service.WithPrincipal(r.Context(), p))
			next.ServeHTTP(w, r)
			return
		}
		if c, e := r.Cookie(a.cookieName()); e == nil && a.cfg.Services.Auth != nil {
			if p, e := a.cfg.Services.Auth.Session(r.Context(), c.Value); e == nil {
				p.IP = clientIP(r)
				r = r.WithContext(service.WithPrincipal(r.Context(), p))
			}
		}
		next.ServeHTTP(w, r)
	})
}
func (a *API) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, e := service.CurrentUser(r.Context()); e != nil {
			respond(w, nil, e)
			return
		}
		next.ServeHTTP(w, r)
	})
}
func (a *API) csrfToken(token string) string {
	h := hmac.New(sha256.New, a.cfg.CSRFKey)
	h.Write([]byte(token))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

// requestCSRF returns the CSRF token bound to the request's session cookie, for
// server-rendered pages. It is empty without a session.
func (a *API) requestCSRF(r *http.Request) string {
	c, e := r.Cookie(a.cookieName())
	if e != nil || c.Value == "" {
		return ""
	}
	return a.csrfToken(c.Value)
}
func (a *API) csrf(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" || r.Method == "HEAD" || r.Method == "OPTIONS" || r.URL.Path == "/api/webhooks/github" || r.URL.Path == "/api/servers/join" {
			next.ServeHTTP(w, r)
			return
		}
		if p, e := service.CurrentUser(r.Context()); e == nil && p.Scopes != nil {
			next.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("Origin") != a.cfg.Origin {
			respond(w, nil, &service.Error{Kind: service.Forbidden, Message: "Invalid origin"})
			return
		}
		if c, e := r.Cookie(a.cookieName()); e == nil {
			if !hmac.Equal([]byte(a.csrfToken(c.Value)), []byte(r.Header.Get("X-CSRF-Token"))) {
				respond(w, nil, &service.Error{Kind: service.Forbidden, Message: "Invalid CSRF token"})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
func (a *API) sse(w http.ResponseWriter, r *http.Request) {
	a.streamEvents(w, r, 15*time.Second)
}
func (a *API) streamEvents(w http.ResponseWriter, r *http.Request, interval time.Duration) {
	sub, e := a.cfg.Services.Logs.Subscribe(r.Context(), r.URL.Query().Get("topic"))
	if e != nil {
		respond(w, nil, e)
		return
	}
	defer sub.Cancel()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	ctrl := http.NewResponseController(w)
	heartbeat := time.NewTicker(interval)
	defer heartbeat.Stop()
	_, _ = io.WriteString(w, ": connected\n\n")
	if e = ctrl.Flush(); e != nil {
		return
	}
	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			if !a.streamAuthorized(r) {
				return
			}
			_ = ctrl.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if _, e = io.WriteString(w, ": heartbeat\n\n"); e != nil {
				return
			}
			if e = ctrl.Flush(); e != nil {
				return
			}
		case event, ok := <-sub.C:
			if !ok {
				return
			}
			_ = ctrl.SetWriteDeadline(time.Now().Add(5 * time.Second))
			b, _ := json.Marshal(json.RawMessage(event.Data))
			if _, e = fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", event.ID, event.Kind, b); e != nil {
				return
			}
			if e = ctrl.Flush(); e != nil {
				return
			}
		}
	}
}

// Long-lived streams must observe logout, credential reset, token revocation and
// expiry too. Recheck on each heartbeat without querying SQLite per log line.
func (a *API) streamAuthorized(r *http.Request) bool {
	initial, e := service.CurrentUser(r.Context())
	if e != nil || a.cfg.Services.Auth == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	var current service.Principal
	if authorization := r.Header.Get("Authorization"); authorization != "" {
		if !strings.HasPrefix(authorization, "Bearer ") {
			return false
		}
		current, e = a.cfg.Services.Auth.AuthenticateToken(ctx, strings.TrimPrefix(authorization, "Bearer "))
	} else {
		cookie, err := r.Cookie(a.cookieName())
		if err != nil {
			return false
		}
		current, e = a.cfg.Services.Auth.Session(ctx, cookie.Value)
	}
	return e == nil && current.ID == initial.ID && current.Role == initial.Role && slices.Equal(current.Scopes, initial.Scopes)
}
func read(w http.ResponseWriter, r *http.Request, v any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		write(w, 415, map[string]string{"code": "unsupported_media_type"})
		return false
	}
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		write(w, 400, map[string]string{"code": "validation", "message": "Invalid JSON"})
		return false
	}
	if e := d.Decode(&struct{}{}); e != io.EOF {
		write(w, 400, map[string]string{"code": "validation", "message": "Unexpected additional JSON"})
		return false
	}
	return true
}
func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func respond(w http.ResponseWriter, v any, e error) {
	if e == nil {
		write(w, 200, v)
		return
	}
	var typed *service.Error
	if !errors.As(e, &typed) {
		slog.Error("request failed", "err", e)
		write(w, 500, map[string]string{"code": "internal", "message": "Internal error"})
		return
	}
	status := 400
	switch typed.Kind {
	case service.Unauthenticated:
		status = 401
	case service.Forbidden:
		status = 403
	case service.NotFound:
		status = 404
	case service.Conflict:
		status = 409
	case service.Unavailable:
		status = 503
	}
	write(w, status, typed)
}

type visitor struct {
	limiter *rate.Limiter
	seen    time.Time
}
type limiter struct {
	mu       sync.Mutex
	visitors map[string]visitor
	limit    rate.Limit
	burst    int
}

func newLimiter(limit rate.Limit, burst int) *limiter {
	return &limiter{visitors: map[string]visitor{}, limit: limit, burst: burst}
}
func (l *limiter) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		now := time.Now()
		l.mu.Lock()
		if len(l.visitors) >= 10000 {
			for key, v := range l.visitors {
				if now.Sub(v.seen) > 10*time.Minute {
					delete(l.visitors, key)
				}
			}
		}
		v, ok := l.visitors[ip]
		if !ok {
			if len(l.visitors) >= 10000 {
				l.mu.Unlock()
				write(w, 429, map[string]string{"code": "rate_limited"})
				return
			}
			v = visitor{limiter: rate.NewLimiter(l.limit, l.burst)}
		}
		v.seen = now
		l.visitors[ip] = v
		allowed := v.limiter.Allow()
		l.mu.Unlock()
		if !allowed {
			w.Header().Set("Retry-After", "10")
			write(w, 429, map[string]string{"code": "rate_limited"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func clientIP(r *http.Request) string {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0])
		if parsed := net.ParseIP(forwarded); parsed != nil {
			return parsed.String()
		}
	}
	return host
}
func (a *API) audit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.cfg.Services.Audit == nil || r.Method == "GET" || r.Method == "HEAD" {
			next.ServeHTTP(w, r)
			return
		}
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 3*time.Second)
		defer cancel()
		route := chi.RouteContext(r.Context()).RoutePattern()
		_ = a.cfg.Services.Audit.RecordRequest(ctx, r.Method, route, ww.Status())
	})
}
