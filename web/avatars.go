package web

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/Nelcota/NelcotaDeploy/web/i18n"
	"github.com/Nelcota/NelcotaDeploy/web/pages"
	"github.com/go-chi/chi/v5"
)

// avatar serves a profile photo.
func (h *handler) avatar(w http.ResponseWriter, r *http.Request) {
	v, err := h.s.Auth.Avatar(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, http.StatusText(statusOf(err)), statusOf(err))
		return
	}
	serveImage(w, r, "image/jpeg", v.Image, v.UpdatedAt)
}

// serveImage sends a stored, re-encoded image. Versioned addresses (?v=) are
// cached, and the response is sandboxed regardless.
func serveImage(w http.ResponseWriter, r *http.Request, contentType string, data []byte, updatedAt int64) {
	version := strconv.FormatInt(updatedAt, 10)
	hd := w.Header()
	hd.Set("Content-Type", contentType)
	hd.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	hd.Set("ETag", `"`+version+`"`)
	if r.URL.Query().Get("v") == version {
		hd.Set("Cache-Control", "private, max-age=31536000, immutable")
	} else {
		hd.Set("Cache-Control", "private, no-cache")
	}
	http.ServeContent(w, r, "", time.UnixMilli(updatedAt), bytes.NewReader(data))
}

func (h *handler) uploadAvatar(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		data, err := uploadedImage(r, "photo")
		if err != nil {
			return err
		}
		if err := h.s.Auth.SetAvatar(r.Context(), data); err != nil {
			return err
		}
		return h.refreshAvatar(s, r, i18n.T(r.Context(), "Profile photo saved."))
	})
}

func (h *handler) removeAvatar(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := h.s.Auth.RemoveAvatar(r.Context()); err != nil {
			return err
		}
		return h.refreshAvatar(s, r, i18n.T(r.Context(), "Profile photo removed."))
	})
}

// refreshAvatar redraws the photo controls and every copy of the photo on the page.
func (h *handler) refreshAvatar(s *stream, r *http.Request, message string) error {
	u := mustUser(r)
	u.AvatarAt = 0
	if v, err := h.s.Auth.Avatar(r.Context(), u.ID); err == nil {
		u.AvatarAt = v.UpdatedAt
	} else if !service.Is(err, service.NotFound) {
		return err
	}
	if err := s.patch(pages.ProfilePhoto(u), "", ""); err != nil {
		return err
	}
	// The account menus show the photo too (the phone one is hidden on wide screens).
	shell := h.shell(r, "", "")
	shell.User = u
	for _, opens := range []string{"right", "down"} {
		if err := s.patch(pages.AccountMenu(shell, opens), "", ""); err != nil {
			return err
		}
	}
	return s.toast("success", message)
}

// uploadedImage reads an image file from a multipart form. The service checks
// and re-encodes it.
func uploadedImage(r *http.Request, field string) ([]byte, error) {
	if err := r.ParseMultipartForm(service.AvatarMaxBytes); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return nil, invalid("The image is too large")
		}
		return nil, invalid("Choose an image")
	}
	f, _, err := r.FormFile(field)
	if err != nil {
		return nil, invalid("Choose an image")
	}
	defer func() { _ = f.Close() }()
	data, err := io.ReadAll(io.LimitReader(f, service.AvatarMaxBytes+1))
	if err != nil {
		return nil, invalid("Choose an image")
	}
	return data, nil
}
