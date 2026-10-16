package web

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/Nelcota/NelcotaDeploy/internal/events"
	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/Nelcota/NelcotaDeploy/web/pages"
	"github.com/go-chi/chi/v5"
)

// logTail returns the last non-empty lines of a stored deployment log.
func (h *handler) logTail(ctx context.Context, id string, n int) []string {
	b, err := h.s.Logs.Read(ctx, id)
	if err != nil {
		return nil
	}
	var out []string
	for _, line := range strings.Split(string(b), "\n") {
		if line = strings.TrimRight(line, "\r "); line != "" {
			if len(line) > 300 {
				line = line[:300] + "…"
			}
			out = append(out, line)
		}
	}
	if len(out) > n {
		out = out[len(out)-n:]
	}
	return out
}

func (h *handler) overview(ctx context.Context, app service.App, usage []pages.Container) pages.OverviewView {
	deploys, err := h.s.Deploys.List(ctx, app.ID)
	if err != nil {
		return pages.OverviewView{Err: publicMessage(err)}
	}
	v := pages.OverviewView{State: pages.StateOf(app, deploys), Deployments: deploys, Usage: usage, CanLatest: h.s.Repos != nil}
	if v.State.Latest.Status == "failed" {
		v.LogTail = h.logTail(ctx, v.State.Latest.ID, 8)
	}
	return v
}

func (h *handler) overviewPage(w http.ResponseWriter, r *http.Request) {
	c, err := h.appContext(r, "overview")
	if err != nil {
		h.failPage(w, r, "apps", err)
		return
	}
	render(w, r, http.StatusOK, pages.Overview(h.shell(r, c.App.Name, "apps"), c, h.overview(r.Context(), c.App, nil)))
}

// appUsage picks the app's containers from a server metrics sample.
func appUsage(m pages.Metrics, app string) []pages.Container {
	var out []pages.Container
	for _, c := range m.Containers {
		if c.AppID == app {
			out = append(out, c)
		}
	}
	return out
}

func (h *handler) overviewStream(w http.ResponseWriter, r *http.Request) {
	c, err := h.appContext(r, "overview")
	if err != nil {
		h.act(w, r, func(*stream) error { return err })
		return
	}
	var usage []pages.Container
	active := false
	body := func(s *stream) error {
		app, err := h.s.Apps.Get(r.Context(), c.App.ID)
		if err != nil {
			return err
		}
		c.App = app
		v := h.overview(r.Context(), app, usage)
		active = v.State.Key == "publishing"
		return s.patch(pages.OverviewBody(c, v), "", "")
	}
	h.live(w, r, []string{"deployments", "apps", "servers"}, body, func(s *stream, ev events.Event) error {
		switch ev.Kind {
		case "server.metrics":
			var sample struct {
				ServerID string        `json:"server_id"`
				Metrics  pages.Metrics `json:"metrics"`
			}
			if json.Unmarshal(ev.Data, &sample) != nil || sample.ServerID != c.App.ServerID {
				return nil
			}
			usage = appUsage(sample.Metrics, c.App.ID)
			return s.patch(pages.UsageCard(c.App, usage), "", "")
		case "deploy.queued", "deploy.status":
			var d service.Deployment
			if json.Unmarshal(ev.Data, &d) != nil || d.AppID != c.App.ID {
				return nil
			}
		case "app.updated":
			var a service.App
			if json.Unmarshal(ev.Data, &a) != nil || a.ID != c.App.ID {
				return nil
			}
		default:
			return nil
		}
		return body(s)
	}, func(s *stream) error {
		if !active {
			return nil
		}
		return body(s)
	})
}

func (h *handler) checkDNS(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		checks, err := h.s.Apps.CheckDomains(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		return s.patch(pages.DNSResults(checks), "#dns-results", modeReplace)
	})
}
