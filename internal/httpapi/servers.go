package httpapi

import (
	"io"
	"net/http"
	"strings"

	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/go-chi/chi/v5"
)

func (a *API) joinServer(w http.ResponseWriter, r *http.Request) {
	var in service.JoinInput
	if !read(w, r, &in) {
		return
	}
	if a.cfg.Enrollment == nil {
		respond(w, nil, &service.Error{Kind: service.Unavailable, Message: "Registration unavailable"})
		return
	}
	v, e := a.cfg.Enrollment.Join(r.Context(), in)
	respond(w, v, e)
}
func (a *API) updateServerLimits(w http.ResponseWriter, r *http.Request) {
	var in service.ServerLimitsInput
	if !read(w, r, &in) {
		return
	}
	v, e := a.cfg.Services.Servers.UpdateLimits(r.Context(), chi.URLParam(r, "id"), in)
	respond(w, v, e)
}
func (a *API) listServers(w http.ResponseWriter, r *http.Request) {
	v, e := a.cfg.Services.Servers.List(r.Context())
	respond(w, v, e)
}
func (a *API) inviteServer(w http.ResponseWriter, r *http.Request) {
	var in service.ServerInput
	if !read(w, r, &in) {
		return
	}
	v, e := a.cfg.Services.Servers.Invite(r.Context(), in)
	respond(w, v, e)
}
func (a *API) pruneServer(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Scope     string `json:"scope"`
		Confirmed bool   `json:"confirmed"`
	}
	if !read(w, r, &in) {
		return
	}
	e := a.cfg.Services.Servers.Prune(r.Context(), chi.URLParam(r, "id"), in.Scope, in.Confirmed)
	respond(w, map[string]bool{"ok": e == nil}, e)
}

func (a *API) githubWebhook(w http.ResponseWriter, r *http.Request) {
	body, e := io.ReadAll(r.Body)
	if e != nil {
		respond(w, nil, e)
		return
	}
	if a.cfg.GitHub == nil {
		respond(w, nil, &service.Error{Kind: service.Unavailable, Message: "GitHub not configured"})
		return
	}
	e = a.cfg.GitHub.Webhook(r.Context(), service.WebhookInput{
		Signature: r.Header.Get("X-Hub-Signature-256"),
		Delivery:  r.Header.Get("X-GitHub-Delivery"),
		Event:     r.Header.Get("X-GitHub-Event"),
		Body:      body,
	})
	respond(w, map[string]bool{"ok": e == nil}, e)
}
func (a *API) githubCallback(w http.ResponseWriter, r *http.Request) {
	if a.cfg.GitHub == nil {
		respond(w, nil, &service.Error{Kind: service.Unavailable, Message: "GitHub unavailable"})
		return
	}
	v, e := a.cfg.GitHub.FinishManifest(r.Context(), r.URL.Query().Get("state"), r.URL.Query().Get("code"))
	// Browsers continue to the App installation on GitHub; API clients keep JSON.
	if strings.Contains(r.Header.Get("Accept"), "application/json") {
		respond(w, v, e)
		return
	}
	if e != nil {
		http.Redirect(w, r, "/settings/github?github=failed", http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, v["installation_url"], http.StatusSeeOther)
}
func (a *API) githubManifest(w http.ResponseWriter, r *http.Request) {
	if a.cfg.GitHub == nil {
		respond(w, nil, &service.Error{Kind: service.Unavailable, Message: "GitHub unavailable"})
		return
	}
	v, e := a.cfg.GitHub.BeginManifest(r.Context(), a.cfg.Origin)
	respond(w, v, e)
}
