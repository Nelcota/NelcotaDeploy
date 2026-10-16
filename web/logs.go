package web

import (
	"net/http"

	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/Nelcota/NelcotaDeploy/web/i18n"
	"github.com/Nelcota/NelcotaDeploy/web/pages"
)

// logsPage shows build logs for one deployment (default: the newest) or the app's
// runtime logs. The browser loads and follows logs through /api.
func (h *handler) logsPage(w http.ResponseWriter, r *http.Request) {
	c, err := h.appContext(r, "logs")
	if err != nil {
		h.failPage(w, r, "apps", err)
		return
	}
	var v pages.LogsView
	v.Deployments, err = h.s.Deploys.List(r.Context(), c.App.ID)
	if err != nil {
		v.Err = publicMessage(err)
	}
	switch id := r.URL.Query().Get("deployment"); {
	case id == "runtime" || (id == "" && len(v.Deployments) == 0):
		v.Runtime = true
	case id == "":
		v.Selected = v.Deployments[0]
	default:
		d, err := h.s.Deploys.Get(r.Context(), id)
		if err == nil && d.AppID != c.App.ID {
			err = &service.Error{Kind: service.NotFound, Message: "Resource not found"}
		}
		if err != nil {
			h.failPage(w, r, "apps", err)
			return
		}
		v.Selected = d
	}
	s := h.shell(r, i18n.Tf(r.Context(), "%s logs", c.App.Name), "apps")
	s.Scripts = append(s.Scripts, "xterm.js", "xterm-fit.js", "logs.js")
	s.Styles = []string{"xterm.css"}
	// xterm.js injects <style> elements for its renderer.
	w.Header().Set("Content-Security-Policy", csp(nonce(r.Context()), true))
	render(w, r, http.StatusOK, pages.Logs(s, c, v))
}
