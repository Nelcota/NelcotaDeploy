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
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/nelcota/nelcota-deploy/internal/service"
	"github.com/nelcota/nelcota-deploy/web"
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
	r.Post("/api/webhooks/github", func(w http.ResponseWriter, r *http.Request) {
		body, e := io.ReadAll(r.Body)
		if e != nil {
			respond(w, nil, e)
			return
		}
		if cfg.GitHub == nil {
			respond(w, nil, &service.Error{Kind: service.Unavailable, Message: "GitHub não configurado"})
			return
		}
		e = cfg.GitHub.Webhook(r.Context(), service.WebhookInput{Signature: r.Header.Get("X-Hub-Signature-256"), Delivery: r.Header.Get("X-GitHub-Delivery"), Event: r.Header.Get("X-GitHub-Event"), Body: body})
		respond(w, map[string]bool{"ok": e == nil}, e)
	})
	r.Get("/api/github/callback", func(w http.ResponseWriter, r *http.Request) {
		if cfg.GitHub == nil {
			respond(w, nil, &service.Error{Kind: service.Unavailable, Message: "GitHub indisponível"})
			return
		}
		v, e := cfg.GitHub.FinishManifest(r.Context(), r.URL.Query().Get("state"), r.URL.Query().Get("code"))
		respond(w, v, e)
	})
	r.Post("/api/servers/join", func(w http.ResponseWriter, r *http.Request) {
		var in service.JoinInput
		if !read(w, r, &in) {
			return
		}
		if cfg.Enrollment == nil {
			respond(w, nil, &service.Error{Kind: service.Unavailable, Message: "Registro indisponível"})
			return
		}
		v, e := cfg.Enrollment.Join(r.Context(), in)
		respond(w, v, e)
	})
	r.Route("/api/auth", func(r chi.Router) {
		r.Use(newLimiter(rate.Every(10*time.Second), 8).middleware)
		r.Post("/register/begin", func(w http.ResponseWriter, r *http.Request) {
			var in service.RegistrationInput
			if !read(w, r, &in) {
				return
			}
			v, e := cfg.Services.Auth.BeginRegistration(r.Context(), in)
			respond(w, v, e)
		})
		r.Post("/register/finish", func(w http.ResponseWriter, r *http.Request) {
			var in service.FinishInput
			if !read(w, r, &in) {
				return
			}
			e := cfg.Services.Auth.FinishRegistration(r.Context(), in)
			respond(w, map[string]bool{"ok": e == nil}, e)
		})
		r.Post("/login/begin", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Email string `json:"email"`
			}
			if !read(w, r, &in) {
				return
			}
			v, e := cfg.Services.Auth.BeginLogin(r.Context(), in.Email)
			respond(w, v, e)
		})
		r.Post("/login/finish", func(w http.ResponseWriter, r *http.Request) {
			var in service.FinishInput
			if !read(w, r, &in) {
				return
			}
			v, e := cfg.Services.Auth.FinishLogin(r.Context(), in)
			if e == nil && v.Token != "" {
				a.cookie(w, v)
			}
			respond(w, v, e)
		})
		r.Post("/totp/verify", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Challenge string `json:"challenge"`
				Code      string `json:"code"`
			}
			if !read(w, r, &in) {
				return
			}
			v, e := cfg.Services.Auth.VerifyTOTP(r.Context(), in.Challenge, in.Code)
			if e == nil {
				a.cookie(w, v)
			}
			respond(w, v, e)
		})
	})
	r.Group(func(r chi.Router) {
		r.Use(a.requireSession)
		r.Get("/api/session", func(w http.ResponseWriter, r *http.Request) {
			p, e := service.CurrentUser(r.Context())
			c, _ := r.Cookie(a.cookieName())
			token := ""
			if c != nil {
				token = c.Value
			}
			respond(w, map[string]any{"user": p, "csrf_token": a.csrfToken(token)}, e)
		})
		r.Post("/api/auth/logout", func(w http.ResponseWriter, r *http.Request) {
			c, _ := r.Cookie(a.cookieName())
			token := ""
			if c != nil {
				token = c.Value
			}
			e := cfg.Services.Auth.Logout(r.Context(), token)
			http.SetCookie(w, &http.Cookie{Name: a.cookieName(), Value: "", Path: "/", HttpOnly: true, Secure: !cfg.Dev, SameSite: http.SameSiteStrictMode, MaxAge: -1})
			respond(w, map[string]bool{"ok": e == nil}, e)
		})
		r.Post("/api/auth/totp/begin", func(w http.ResponseWriter, r *http.Request) {
			v, e := cfg.Services.Auth.BeginTOTP(r.Context())
			respond(w, v, e)
		})
		r.Post("/api/auth/totp/finish", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				ID   string `json:"id"`
				Code string `json:"code"`
			}
			if !read(w, r, &in) {
				return
			}
			e := cfg.Services.Auth.FinishTOTP(r.Context(), in.ID, in.Code)
			respond(w, map[string]bool{"ok": e == nil}, e)
		})
		r.Get("/api/apps", func(w http.ResponseWriter, r *http.Request) {
			v, e := cfg.Services.Apps.List(r.Context())
			respond(w, v, e)
		})
		r.Post("/api/apps", func(w http.ResponseWriter, r *http.Request) {
			var in service.AppInput
			if !read(w, r, &in) {
				return
			}
			v, e := cfg.Services.Apps.Create(r.Context(), in)
			respond(w, v, e)
		})
		r.Get("/api/apps/{id}", func(w http.ResponseWriter, r *http.Request) {
			v, e := cfg.Services.Apps.Get(r.Context(), chi.URLParam(r, "id"))
			respond(w, v, e)
		})
		r.Put("/api/apps/{id}", func(w http.ResponseWriter, r *http.Request) {
			var in service.AppInput
			if !read(w, r, &in) {
				return
			}
			v, e := cfg.Services.Apps.Update(r.Context(), chi.URLParam(r, "id"), in)
			respond(w, v, e)
		})
		r.Delete("/api/apps/{id}", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Confirmed bool `json:"confirmed"`
			}
			if !read(w, r, &in) {
				return
			}
			e := cfg.Services.Apps.Delete(r.Context(), chi.URLParam(r, "id"), in.Confirmed)
			respond(w, map[string]bool{"ok": e == nil}, e)
		})
		r.Get("/api/apps/{id}/env", func(w http.ResponseWriter, r *http.Request) {
			v, e := cfg.Services.Apps.Environment(r.Context(), chi.URLParam(r, "id"))
			respond(w, v, e)
		})
		r.Put("/api/apps/{id}/env", func(w http.ResponseWriter, r *http.Request) {
			var in []service.EnvInput
			if !read(w, r, &in) {
				return
			}
			e := cfg.Services.Apps.SetEnvironment(r.Context(), chi.URLParam(r, "id"), in)
			respond(w, map[string]bool{"ok": e == nil}, e)
		})
		r.Post("/api/apps/{id}/actions", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Action    string `json:"action"`
				Replicas  uint32 `json:"replicas"`
				Confirmed bool   `json:"confirmed"`
			}
			if !read(w, r, &in) {
				return
			}
			e := cfg.Services.Apps.Action(r.Context(), chi.URLParam(r, "id"), in.Action, in.Replicas, in.Confirmed)
			respond(w, map[string]bool{"ok": e == nil}, e)
		})
		r.Get("/api/apps/{id}/deployments", func(w http.ResponseWriter, r *http.Request) {
			v, e := cfg.Services.Deploys.List(r.Context(), chi.URLParam(r, "id"))
			respond(w, v, e)
		})
		r.Post("/api/deployments", func(w http.ResponseWriter, r *http.Request) {
			var in service.DeployInput
			if !read(w, r, &in) {
				return
			}
			v, e := cfg.Services.Deploys.Enqueue(r.Context(), in)
			respond(w, v, e)
		})
		r.Get("/api/deployments/{id}", func(w http.ResponseWriter, r *http.Request) {
			v, e := cfg.Services.Deploys.Get(r.Context(), chi.URLParam(r, "id"))
			respond(w, v, e)
		})
		r.Post("/api/deployments/{id}/cancel", func(w http.ResponseWriter, r *http.Request) {
			e := cfg.Services.Deploys.Cancel(r.Context(), chi.URLParam(r, "id"))
			respond(w, map[string]bool{"ok": e == nil}, e)
		})
		r.Get("/api/deployments/{id}/logs", func(w http.ResponseWriter, r *http.Request) {
			v, e := cfg.Services.Logs.Read(r.Context(), chi.URLParam(r, "id"))
			respond(w, map[string]string{"text": string(v)}, e)
		})
		r.Get("/api/events", a.sse)
		r.Get("/api/servers", func(w http.ResponseWriter, r *http.Request) {
			v, e := cfg.Services.Servers.List(r.Context())
			respond(w, v, e)
		})
		r.Post("/api/servers/invite", func(w http.ResponseWriter, r *http.Request) {
			var in service.ServerInput
			if !read(w, r, &in) {
				return
			}
			v, e := cfg.Services.Servers.Invite(r.Context(), in)
			respond(w, v, e)
		})
		r.Post("/api/servers/{id}/prune", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Scope     string `json:"scope"`
				Confirmed bool   `json:"confirmed"`
			}
			if !read(w, r, &in) {
				return
			}
			e := cfg.Services.Servers.Prune(r.Context(), chi.URLParam(r, "id"), in.Scope, in.Confirmed)
			respond(w, map[string]bool{"ok": e == nil}, e)
		})
		r.Post("/api/github/manifest", func(w http.ResponseWriter, r *http.Request) {
			if cfg.GitHub == nil {
				respond(w, nil, &service.Error{Kind: service.Unavailable, Message: "GitHub indisponível"})
				return
			}
			v, e := cfg.GitHub.BeginManifest(r.Context(), cfg.Origin)
			respond(w, v, e)
		})
		r.Get("/api/settings", func(w http.ResponseWriter, r *http.Request) {
			v, e := cfg.Services.Settings.Get(r.Context())
			respond(w, v, e)
		})
		r.Put("/api/settings/{key}", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Value string `json:"value"`
			}
			if !read(w, r, &in) {
				return
			}
			e := cfg.Services.Settings.Set(r.Context(), chi.URLParam(r, "key"), in.Value)
			respond(w, map[string]bool{"ok": e == nil}, e)
		})
		r.Get("/api/audit", func(w http.ResponseWriter, r *http.Request) {
			v, e := cfg.Services.Audit.List(r.Context(), 100)
			respond(w, v, e)
		})
		r.Get("/api/tokens", func(w http.ResponseWriter, r *http.Request) {
			v, e := cfg.Services.Auth.Tokens(r.Context())
			respond(w, v, e)
		})
		r.Post("/api/tokens", func(w http.ResponseWriter, r *http.Request) {
			var in service.TokenInput
			if !read(w, r, &in) {
				return
			}
			v, e := cfg.Services.Auth.CreateToken(r.Context(), in)
			respond(w, v, e)
		})
		r.Delete("/api/tokens/{id}", func(w http.ResponseWriter, r *http.Request) {
			e := cfg.Services.Auth.RevokeToken(r.Context(), chi.URLParam(r, "id"))
			respond(w, map[string]bool{"ok": e == nil}, e)
		})
		r.Get("/api/users", func(w http.ResponseWriter, r *http.Request) {
			v, e := cfg.Services.Users.List(r.Context())
			respond(w, v, e)
		})
		r.Post("/api/users", func(w http.ResponseWriter, r *http.Request) {
			var in service.UserInput
			if !read(w, r, &in) {
				return
			}
			v, e := cfg.Services.Users.Create(r.Context(), in)
			respond(w, v, e)
		})
	})
	if cfg.Dev && cfg.DevelopmentLogin != nil {
		r.Post("/api/dev/session", func(w http.ResponseWriter, r *http.Request) {
			v, e := cfg.DevelopmentLogin(r.Context())
			if e == nil {
				a.cookie(w, v)
			}
			respond(w, map[string]bool{"ok": e == nil}, e)
		})
	}
	web.Register(r, cfg.Services)
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
				respond(w, nil, &service.Error{Kind: service.Unauthenticated, Message: "Token inválido"})
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
			respond(w, nil, &service.Error{Kind: service.Forbidden, Message: "Origem inválida"})
			return
		}
		if c, e := r.Cookie(a.cookieName()); e == nil {
			if !hmac.Equal([]byte(a.csrfToken(c.Value)), []byte(r.Header.Get("X-CSRF-Token"))) {
				respond(w, nil, &service.Error{Kind: service.Forbidden, Message: "CSRF inválido"})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
func (a *API) sse(w http.ResponseWriter, r *http.Request) {
	sub, e := a.cfg.Services.Logs.Subscribe(r.Context(), r.URL.Query().Get("topic"))
	if e != nil {
		respond(w, nil, e)
		return
	}
	defer sub.Cancel()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	ctrl := http.NewResponseController(w)
	heartbeat := time.NewTicker(15 * time.Second)
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
func read(w http.ResponseWriter, r *http.Request, v any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		write(w, 415, map[string]string{"code": "unsupported_media_type"})
		return false
	}
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		write(w, 400, map[string]string{"code": "validation", "message": "JSON inválido"})
		return false
	}
	if e := d.Decode(&struct{}{}); e != io.EOF {
		write(w, 400, map[string]string{"code": "validation", "message": "JSON adicional"})
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
		write(w, 500, map[string]string{"code": "internal", "message": "Falha interna"})
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
