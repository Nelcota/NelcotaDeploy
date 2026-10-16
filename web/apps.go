package web

import (
	"net/http"

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
