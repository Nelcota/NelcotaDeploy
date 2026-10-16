package web

import (
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/Nelcota/NelcotaDeploy/web/i18n"
	"github.com/Nelcota/NelcotaDeploy/web/pages"
	"github.com/go-chi/chi/v5"
)

func (h *handler) serversPage(w http.ResponseWriter, r *http.Request) {
	var v pages.ServersView
	var err error
	if v.Servers, err = h.s.Servers.List(r.Context()); err != nil {
		v.Err = publicMessage(err)
	}
	v.Apps, _ = h.s.Apps.List(r.Context())
	s := h.shell(r, "Servers", "servers")
	s.Scripts = append(s.Scripts, "uplot.js", "metrics.js")
	s.Styles = []string{"uplot.css"}
	render(w, r, http.StatusOK, pages.Servers(s, v))
}

// cacheBytes converts a GiB form value (fractions allowed) to bytes.
func cacheBytes(v string) (int64, error) {
	f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil || math.IsNaN(f) || f <= 0 {
		return 0, invalid("Cache limit must be a number of GiB")
	}
	return int64(math.Round(f * (1 << 30))), nil
}

func (h *handler) inviteServer(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := r.ParseForm(); err != nil {
			return invalid("Invalid form")
		}
		builds, err := strconv.Atoi(strings.TrimSpace(r.PostForm.Get("build_limit")))
		if err != nil {
			return invalid("Concurrent builds must be a whole number")
		}
		cache, err := cacheBytes(r.PostForm.Get("cache_gib"))
		if err != nil {
			return err
		}
		name := strings.TrimSpace(r.PostForm.Get("name"))
		inv, err := h.s.Servers.Invite(r.Context(), service.ServerInput{Name: name, WireGuardIP: strings.TrimSpace(r.PostForm.Get("wireguard_ip")), BuildLimit: builds, CacheBytes: cache})
		if err != nil {
			return err
		}
		if err := s.patch(pages.InviteResult(h.inviteView(name, inv)), "", ""); err != nil {
			return err
		}
		if servers, err := h.s.Servers.List(r.Context()); err == nil {
			for _, srv := range servers {
				if srv.ID == inv.ServerID {
					if err := s.patch(pages.ServerPanel(h.shell(r, "", ""), srv), "#servers-list", modeAppend); err != nil {
						return err
					}
				}
			}
		}
		return s.closeAndReset("#invite")
	})
}

func (h *handler) pruneServer(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		scope := chi.URLParam(r, "scope")
		if err := h.s.Servers.Prune(r.Context(), chi.URLParam(r, "id"), scope, true); err != nil {
			return err
		}
		if scope == "cache" {
			return s.toast("success", "Clearing the build cache.")
		}
		return s.toast("success", "Removing unused images.")
	})
}

func (h *handler) serverLimits(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := r.ParseForm(); err != nil {
			return invalid("Invalid form")
		}
		builds, err := strconv.Atoi(strings.TrimSpace(r.PostForm.Get("build_limit")))
		if err != nil {
			return invalid("Concurrent builds must be a whole number")
		}
		cache, err := cacheBytes(r.PostForm.Get("cache_gib"))
		if err != nil {
			return err
		}
		srv, err := h.s.Servers.UpdateLimits(r.Context(), chi.URLParam(r, "id"), service.ServerLimitsInput{BuildLimit: builds, CacheBytes: cache})
		if err != nil {
			return err
		}
		if err := s.patch(pages.ServerLimits(srv), "", ""); err != nil {
			return err
		}
		if err := s.closeAndReset("#server-" + srv.ID); err != nil {
			return err
		}
		return s.toast("success", i18n.Tf(r.Context(), "Limits saved for %s.", srv.Name))
	})
}
