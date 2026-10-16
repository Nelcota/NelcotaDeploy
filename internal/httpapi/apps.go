package httpapi

import (
	"net/http"

	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/go-chi/chi/v5"
)

func (a *API) listApps(w http.ResponseWriter, r *http.Request) {
	v, e := a.cfg.Services.Apps.List(r.Context())
	respond(w, v, e)
}
func (a *API) createApp(w http.ResponseWriter, r *http.Request) {
	var in service.AppInput
	if !read(w, r, &in) {
		return
	}
	v, e := a.cfg.Services.Apps.Create(r.Context(), in)
	respond(w, v, e)
}
func (a *API) getApp(w http.ResponseWriter, r *http.Request) {
	v, e := a.cfg.Services.Apps.Get(r.Context(), chi.URLParam(r, "id"))
	respond(w, v, e)
}
func (a *API) updateApp(w http.ResponseWriter, r *http.Request) {
	var in service.AppInput
	if !read(w, r, &in) {
		return
	}
	v, e := a.cfg.Services.Apps.Update(r.Context(), chi.URLParam(r, "id"), in)
	respond(w, v, e)
}
func (a *API) deleteApp(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Confirmed bool `json:"confirmed"`
	}
	if !read(w, r, &in) {
		return
	}
	e := a.cfg.Services.Apps.Delete(r.Context(), chi.URLParam(r, "id"), in.Confirmed)
	respond(w, map[string]bool{"ok": e == nil}, e)
}
func (a *API) appEnvironment(w http.ResponseWriter, r *http.Request) {
	v, e := a.cfg.Services.Apps.Environment(r.Context(), chi.URLParam(r, "id"))
	respond(w, v, e)
}
func (a *API) setAppEnvironment(w http.ResponseWriter, r *http.Request) {
	var in []service.EnvInput
	if !read(w, r, &in) {
		return
	}
	e := a.cfg.Services.Apps.SetEnvironment(r.Context(), chi.URLParam(r, "id"), in)
	respond(w, map[string]bool{"ok": e == nil}, e)
}
func (a *API) appAction(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Action    string `json:"action"`
		Replicas  uint32 `json:"replicas"`
		Confirmed bool   `json:"confirmed"`
	}
	if !read(w, r, &in) {
		return
	}
	e := a.cfg.Services.Apps.Action(r.Context(), chi.URLParam(r, "id"), in.Action, in.Replicas, in.Confirmed)
	respond(w, map[string]bool{"ok": e == nil}, e)
}
func (a *API) listDeployments(w http.ResponseWriter, r *http.Request) {
	v, e := a.cfg.Services.Deploys.List(r.Context(), chi.URLParam(r, "id"))
	respond(w, v, e)
}
func (a *API) enqueueDeployment(w http.ResponseWriter, r *http.Request) {
	var in service.DeployInput
	if !read(w, r, &in) {
		return
	}
	v, e := a.cfg.Services.Deploys.Enqueue(r.Context(), in)
	respond(w, v, e)
}
func (a *API) getDeployment(w http.ResponseWriter, r *http.Request) {
	v, e := a.cfg.Services.Deploys.Get(r.Context(), chi.URLParam(r, "id"))
	respond(w, v, e)
}
func (a *API) cancelDeployment(w http.ResponseWriter, r *http.Request) {
	e := a.cfg.Services.Deploys.Cancel(r.Context(), chi.URLParam(r, "id"))
	respond(w, map[string]bool{"ok": e == nil}, e)
}
func (a *API) deploymentLogs(w http.ResponseWriter, r *http.Request) {
	v, e := a.cfg.Services.Logs.Read(r.Context(), chi.URLParam(r, "id"))
	respond(w, map[string]string{"text": string(v)}, e)
}
