package web

import (
	"net/http"

	"github.com/Nelcota/NelcotaDeploy/web/i18n"
	"github.com/Nelcota/NelcotaDeploy/web/pages"
	"github.com/go-chi/chi/v5"
)

// appLogo serves an app's logo.
func (h *handler) appLogo(w http.ResponseWriter, r *http.Request) {
	v, err := h.s.Apps.Logo(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, http.StatusText(statusOf(err)), statusOf(err))
		return
	}
	serveImage(w, r, "image/png", v.Image, v.UpdatedAt)
}

func (h *handler) uploadLogo(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		data, err := uploadedImage(r, "logo")
		if err != nil {
			return err
		}
		if err := h.s.Apps.SetLogo(r.Context(), chi.URLParam(r, "id"), data); err != nil {
			return err
		}
		return h.refreshLogo(s, r, i18n.T(r.Context(), "Logo saved."))
	})
}

func (h *handler) removeLogo(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := h.s.Apps.RemoveLogo(r.Context(), chi.URLParam(r, "id")); err != nil {
			return err
		}
		return h.refreshLogo(s, r, i18n.T(r.Context(), "Logo removed."))
	})
}

// refreshLogo redraws the logo controls and the app header's logo.
func (h *handler) refreshLogo(s *stream, r *http.Request, message string) error {
	app, err := h.s.Apps.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	if err := s.patch(pages.LogoSettings(app), "", ""); err != nil {
		return err
	}
	if err := s.patch(pages.AppHeaderLogo(app), "", ""); err != nil {
		return err
	}
	return s.toast("success", message)
}
