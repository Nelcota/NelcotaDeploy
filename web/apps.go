package web

import (
	"net/http"

	"github.com/Nelcota/NelcotaDeploy/internal/events"
	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/Nelcota/NelcotaDeploy/web/pages"
)

func (h *handler) appsPage(w http.ResponseWriter, r *http.Request) {
	rows, _, err := h.appRows(r.Context())
	msg := ""
	if err != nil {
		msg = publicMessage(err)
	}
	render(w, r, http.StatusOK, pages.AppsList(h.shell(r, "Apps", "apps"), rows, msg))
}

// appsStream keeps the Apps page current: status counts and rows are redrawn
// when apps, deployments, or servers change. The search field and the chosen
// filter live in the browser and are left alone.
func (h *handler) appsStream(w http.ResponseWriter, r *http.Request) {
	body := func(s *stream) error {
		rows, _, err := h.appRows(r.Context())
		msg := ""
		if err != nil {
			msg = publicMessage(err)
		}
		if err := s.patch(pages.AppsFilters(rows), "", ""); err != nil {
			return err
		}
		p, _ := service.CurrentUser(r.Context())
		return s.patch(pages.AppsContent(rows, msg, p.Role == "admin"), "", "")
	}
	h.live(w, r, []string{"servers", "deployments", "apps"}, body, func(s *stream, ev events.Event) error {
		// Metrics don't change the list.
		if ev.Kind == "server.metrics" {
			return nil
		}
		return body(s)
	}, nil)
}
