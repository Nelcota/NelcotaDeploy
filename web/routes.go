// Package web renders the panel interface with templ and Datastar. Handlers only
// call internal/service; authorization and business rules stay in the services.
package web

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/Nelcota/NelcotaDeploy/web/i18n"
	"github.com/Nelcota/NelcotaDeploy/web/pages"
	"github.com/Nelcota/NelcotaDeploy/web/static"
	"github.com/a-h/templ"
	"github.com/go-chi/chi/v5"
)

// Config is supplied by internal/httpapi, which owns sessions and CSRF.
type Config struct {
	Services service.Services
	// Origin is the exact public panel origin, used in displayed install commands.
	Origin string
	// Dev enables the development banner; DevLogin exposes the simulated sign-in.
	Dev      bool
	DevLogin bool
	Version  string
	// CSRFToken returns the token for the request's session cookie.
	CSRFToken func(*http.Request) string
	// Authorized revalidates a long-lived stream's credentials.
	Authorized func(*http.Request) bool
}

type handler struct {
	cfg Config
	s   service.Services
}

// Register is the frontend extension point called by internal/httpapi.
func Register(r chi.Router, cfg Config) {
	if cfg.CSRFToken == nil {
		cfg.CSRFToken = func(*http.Request) string { return "" }
	}
	if cfg.Authorized == nil {
		cfg.Authorized = func(*http.Request) bool { return true }
	}
	h := &handler{cfg: cfg, s: cfg.Services}
	assets := static.Handler()
	r.Get(static.Prefix+"*", assets.ServeHTTP)
	r.Head(static.Prefix+"*", assets.ServeHTTP)

	r.Group(func(r chi.Router) {
		r.Use(h.locale, h.pageHeaders)
		h.publicPages(r)
		r.Group(func(r chi.Router) {
			r.Use(h.requirePage)
			h.pages(r)
		})
	})
	r.Route("/ui", func(r chi.Router) {
		r.Use(h.locale, h.requireAction)
		h.actions(r)
	})
	// Unknown pages get the panel's 404 page; API clients keep a plain response.
	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/ui/") || strings.HasPrefix(r.URL.Path, static.Prefix) {
			http.NotFound(w, r)
			return
		}
		h.locale(h.pageHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h.failPage(w, r, "", &service.Error{Kind: service.NotFound, Message: "This page does not exist."})
		}))).ServeHTTP(w, r)
	})
}

// locale renders the request in the viewer's language. A page request with
// ?lang= stores the choice in a cookie and reloads the same address without it.
func (h *handler) locale(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if tag := r.URL.Query().Get(i18n.Param); tag != "" && r.Method == http.MethodGet {
			if l, ok := i18n.Parse(tag); ok {
				http.SetCookie(w, &http.Cookie{Name: i18n.Cookie, Value: string(l), Path: "/", MaxAge: 365 * 24 * 60 * 60, HttpOnly: true, Secure: strings.HasPrefix(h.cfg.Origin, "https://"), SameSite: http.SameSiteLaxMode})
			}
			q := r.URL.Query()
			q.Del(i18n.Param)
			target := r.URL.Path
			if len(q) > 0 {
				target += "?" + q.Encode()
			}
			w.Header().Set("Cache-Control", "no-store")
			http.Redirect(w, r, safeNext(target), http.StatusSeeOther)
			return
		}
		next.ServeHTTP(w, r.WithContext(i18n.WithLocale(r.Context(), i18n.Detect(r))))
	})
}

type nonceKey struct{}

func nonce(ctx context.Context) string {
	n, _ := ctx.Value(nonceKey{}).(string)
	return n
}

// csp builds the page policy. Scripts need the per-request nonce because Datastar
// compiles expressions into nonce-bearing scripts instead of using eval.
func csp(n string, inlineStyles bool) string {
	style := "'self'"
	if inlineStyles {
		// xterm.js injects <style> elements for terminal geometry and themes.
		style += " 'unsafe-inline'"
	}
	return "default-src 'self'; script-src 'self' 'nonce-" + n + "'; style-src " + style + "; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://github.com"
}

func (h *handler) pageHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, 18)
		_, _ = rand.Read(b)
		n := base64.RawStdEncoding.EncodeToString(b)
		w.Header().Set("Content-Security-Policy", csp(n, false))
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), nonceKey{}, n)))
	})
}

func (h *handler) requirePage(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := service.CurrentUser(r.Context()); err != nil {
			http.Redirect(w, r, "/login?next="+url.QueryEscape(r.URL.RequestURI()), http.StatusSeeOther)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (h *handler) requireAction(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := service.CurrentUser(r.Context()); err != nil {
			if r.Header.Get("Datastar-Request") != "" {
				_ = newStream(w, r).redirect("/login")
				return
			}
			http.Error(w, "Authentication required", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (h *handler) shell(r *http.Request, title, section string) pages.Shell {
	user, err := service.CurrentUser(r.Context())
	var alerts pages.Alerts
	if err == nil {
		alerts = h.alerts(r.Context())
	}
	return pages.Shell{Alerts: alerts, Title: title, Nonce: nonce(r.Context()), CSRF: h.cfg.CSRFToken(r), User: user, Section: section, Dev: h.cfg.Dev, Version: h.cfg.Version, Path: r.URL.RequestURI(), Scripts: []string{"cmdk.js", "auth.js"}}
}

func render(w http.ResponseWriter, r *http.Request, status int, c templ.Component) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if err := c.Render(r.Context(), w); err != nil {
		slog.Debug("render failed", "path", r.URL.Path, "err", err)
	}
}

// publicMessage returns a typed service message or a generic one. Internal errors
// never reach the browser.
func publicMessage(err error) string {
	var typed *service.Error
	if errors.As(err, &typed) {
		return typed.Message
	}
	return "Something went wrong. Try again."
}

func statusOf(err error) int {
	var typed *service.Error
	if !errors.As(err, &typed) {
		return http.StatusInternalServerError
	}
	switch typed.Kind {
	case service.NotFound:
		return http.StatusNotFound
	case service.Forbidden:
		return http.StatusForbidden
	case service.Unauthenticated:
		return http.StatusUnauthorized
	case service.Validation:
		return http.StatusBadRequest
	case service.Conflict:
		return http.StatusConflict
	default:
		return http.StatusServiceUnavailable
	}
}

// failPage renders an error page inside the shell for a failed service call.
func (h *handler) failPage(w http.ResponseWriter, r *http.Request, section string, err error) {
	if service.Is(err, service.Unauthenticated) {
		http.Redirect(w, r, "/login", http.StatusSeeOther)
		return
	}
	status := statusOf(err)
	title := "Something went wrong"
	switch status {
	case http.StatusNotFound:
		title = "Not found"
	case http.StatusForbidden:
		title = "Permission required"
	}
	render(w, r, status, pages.ErrorPage(h.shell(r, title, section), title, publicMessage(err)))
}

// act runs a Datastar action and reports failures as toasts; a recent-sign-in
// requirement opens the re-authentication dialog instead.
func (h *handler) act(w http.ResponseWriter, r *http.Request, fn func(*stream) error) {
	s := newStream(w, r)
	if err := fn(s); err != nil {
		// requireAction already verified the session, so Unauthenticated here is a
		// failed ceremony (expired challenge, wrong code) and is shown as a message.
		if isReauth(err) {
			_ = s.signals(map[string]any{"_reauth": true})
			return
		}
		_ = s.toast("danger", publicMessage(err))
	}
}

// isReauth recognizes the services' recent-authentication requirement.
func isReauth(err error) bool {
	var typed *service.Error
	return errors.As(err, &typed) && typed.Kind == service.Forbidden && strings.Contains(strings.ToLower(typed.Message), "reauthentication")
}

// safeNext keeps post-login navigation on this origin.
func safeNext(next string) string {
	if next == "" || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") || strings.ContainsAny(next, "\\\r\n") {
		return "/"
	}
	return next
}
