package httpapi

import (
	"net/http"

	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/go-chi/chi/v5"
)

func (a *API) listOperations(w http.ResponseWriter, r *http.Request) {
	v, e := a.cfg.Services.Operations.List(r.Context())
	respond(w, v, e)
}
func (a *API) backup(w http.ResponseWriter, r *http.Request) {
	v, e := a.cfg.Services.Operations.Backup(r.Context())
	respond(w, v, e)
}
func (a *API) update(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Version string `json:"version"`
	}
	if !read(w, r, &in) {
		return
	}
	v, e := a.cfg.Services.Operations.Update(r.Context(), in.Version)
	respond(w, v, e)
}
func (a *API) cancelOperation(w http.ResponseWriter, r *http.Request) {
	e := a.cfg.Services.Operations.Cancel(r.Context(), chi.URLParam(r, "batch"))
	respond(w, map[string]bool{"ok": e == nil}, e)
}

func (a *API) getSettings(w http.ResponseWriter, r *http.Request) {
	v, e := a.cfg.Services.Settings.Get(r.Context())
	respond(w, v, e)
}
func (a *API) setSetting(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Value string `json:"value"`
	}
	if !read(w, r, &in) {
		return
	}
	e := a.cfg.Services.Settings.Set(r.Context(), chi.URLParam(r, "key"), in.Value)
	respond(w, map[string]bool{"ok": e == nil}, e)
}
func (a *API) listAudit(w http.ResponseWriter, r *http.Request) {
	v, e := a.cfg.Services.Audit.List(r.Context(), 100)
	respond(w, v, e)
}

func (a *API) listTokens(w http.ResponseWriter, r *http.Request) {
	v, e := a.cfg.Services.Auth.Tokens(r.Context())
	respond(w, v, e)
}
func (a *API) createToken(w http.ResponseWriter, r *http.Request) {
	var in service.TokenInput
	if !read(w, r, &in) {
		return
	}
	v, e := a.cfg.Services.Auth.CreateToken(r.Context(), in)
	respond(w, v, e)
}
func (a *API) revokeToken(w http.ResponseWriter, r *http.Request) {
	e := a.cfg.Services.Auth.RevokeToken(r.Context(), chi.URLParam(r, "id"))
	respond(w, map[string]bool{"ok": e == nil}, e)
}

func (a *API) listUsers(w http.ResponseWriter, r *http.Request) {
	v, e := a.cfg.Services.Users.List(r.Context())
	respond(w, v, e)
}
func (a *API) setUserRole(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Role string `json:"role"`
	}
	if !read(w, r, &in) {
		return
	}
	e := a.cfg.Services.Users.SetRole(r.Context(), chi.URLParam(r, "id"), in.Role)
	respond(w, map[string]bool{"ok": e == nil}, e)
}
func (a *API) removeUser(w http.ResponseWriter, r *http.Request) {
	e := a.cfg.Services.Users.Remove(r.Context(), chi.URLParam(r, "id"))
	respond(w, map[string]bool{"ok": e == nil}, e)
}
func (a *API) createUser(w http.ResponseWriter, r *http.Request) {
	var in service.UserInput
	if !read(w, r, &in) {
		return
	}
	v, e := a.cfg.Services.Users.Create(r.Context(), in)
	respond(w, v, e)
}
