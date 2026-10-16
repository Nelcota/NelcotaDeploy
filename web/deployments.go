package web

import (
	"encoding/json"
	"net/http"

	"github.com/Nelcota/NelcotaDeploy/internal/events"
	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/Nelcota/NelcotaDeploy/web/i18n"
	"github.com/Nelcota/NelcotaDeploy/web/pages"
	"github.com/Nelcota/NelcotaDeploy/web/ui"
	"github.com/go-chi/chi/v5"
)

// appContext loads the app shared by the app tabs.
func (h *handler) appContext(r *http.Request, tab string) (pages.AppContext, error) {
	app, err := h.s.Apps.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		return pages.AppContext{}, err
	}
	c := pages.AppContext{App: app, Tab: tab}
	if servers, err := h.s.Servers.List(r.Context()); err == nil {
		for _, s := range servers {
			if s.ID == app.ServerID {
				c.ServerName = s.Name
			}
		}
	}
	return c, nil
}

func (h *handler) deployments(r *http.Request, id string) pages.DeploymentsView {
	list, err := h.s.Deploys.List(r.Context(), id)
	if err != nil {
		return pages.DeploymentsView{Err: publicMessage(err)}
	}
	return pages.DeploymentsView{Deployments: list}
}

func (h *handler) deploymentsPage(w http.ResponseWriter, r *http.Request) {
	c, err := h.appContext(r, "deployments")
	if err != nil {
		h.failPage(w, r, "apps", err)
		return
	}
	render(w, r, http.StatusOK, pages.Deployments(h.shell(r, i18n.Tf(r.Context(), "%s history", c.App.Name), "apps"), c, h.deployments(r, c.App.ID)))
}

func (h *handler) deploymentsStream(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	app, err := h.s.Apps.Get(r.Context(), id)
	if err != nil {
		h.act(w, r, func(*stream) error { return err })
		return
	}
	var active bool
	table := func(s *stream) error {
		v := h.deployments(r, id)
		active = false
		for _, d := range v.Deployments {
			active = active || ui.Active(d.Status)
		}
		return s.patch(pages.DeploymentsTable(app, v), "", "")
	}
	h.live(w, r, []string{"deployments"}, table, func(s *stream, ev events.Event) error {
		var d service.Deployment
		if json.Unmarshal(ev.Data, &d) != nil || d.AppID != id {
			return nil
		}
		return table(s)
	}, func(s *stream) error {
		// Stage timings and running durations are persisted without an event on
		// this topic, so refresh while a deployment is in progress.
		if !active {
			return nil
		}
		return table(s)
	})
}

func (h *handler) cancelDeployment(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := h.s.Deploys.Cancel(r.Context(), chi.URLParam(r, "id")); err != nil {
			return err
		}
		return s.toast("success", "Cancelling. The current version keeps running.")
	})
}

func (h *handler) rollbackDeployment(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		d, err := h.s.Deploys.Get(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		if _, err := h.s.Deploys.Rollback(r.Context(), d.AppID, d.SHA); err != nil {
			return err
		}
		return s.toast("success", i18n.Tf(r.Context(), "Restoring version %s.", ui.ShortSHA(d.SHA)))
	})
}
