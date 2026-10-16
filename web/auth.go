package web

import (
	"bytes"
	"encoding/base64"
	"image/png"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/Nelcota/NelcotaDeploy/web/pages"
	"github.com/go-chi/chi/v5"
	"github.com/pquerna/otp"
)

func (h *handler) loginPage(w http.ResponseWriter, r *http.Request) {
	next := safeNext(r.URL.Query().Get("next"))
	if _, err := service.CurrentUser(r.Context()); err == nil {
		http.Redirect(w, r, next, http.StatusSeeOther)
		return
	}
	s := h.shell(r, "Sign in", "")
	s.Scripts = []string{"auth.js"}
	render(w, r, http.StatusOK, pages.Login(s, next, r.URL.Query().Get("notice"), h.cfg.DevLogin))
}

func (h *handler) enrollPage(w http.ResponseWriter, r *http.Request) {
	s := h.shell(r, "Set up your passkey", "")
	s.Scripts = []string{"auth.js"}
	render(w, r, http.StatusOK, pages.Enroll(s))
}

func (h *handler) account(r *http.Request) pages.AccountView {
	var v pages.AccountView
	f, err := h.s.Auth.Factors(r.Context())
	if err != nil {
		v.Err = publicMessage(err)
	}
	v.Factors = f
	v.Tokens, err = h.s.Auth.Tokens(r.Context())
	if err != nil {
		v.TokErr = publicMessage(err)
	}
	return v
}

func (h *handler) accountPage(w http.ResponseWriter, r *http.Request) {
	render(w, r, http.StatusOK, pages.Account(h.shell(r, "Account", "settings"), h.account(r)))
}

func (h *handler) removePasskey(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := h.s.Auth.RemovePasskey(r.Context(), chi.URLParam(r, "id")); err != nil {
			return err
		}
		f, err := h.s.Auth.Factors(r.Context())
		if err != nil {
			return err
		}
		if err := s.patch(pages.Passkeys(f), "", ""); err != nil {
			return err
		}
		return s.toast("success", "Passkey removed.")
	})
}

func (h *handler) beginTOTP(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		setup, err := h.s.Auth.BeginTOTP(r.Context())
		if err != nil {
			return err
		}
		key, err := otp.NewKeyFromURL(setup.URL)
		if err != nil {
			return err
		}
		img, err := key.Image(360, 360)
		if err != nil {
			return err
		}
		var b bytes.Buffer
		if err := png.Encode(&b, img); err != nil {
			return err
		}
		qr := "data:image/png;base64," + base64.StdEncoding.EncodeToString(b.Bytes())
		return s.patch(pages.TOTPSetup(setup.ID, qr, groupSecret(key.Secret())), "", "")
	})
}

// groupSecret splits a base32 secret into blocks of four for manual entry.
func groupSecret(secret string) string {
	var parts []string
	for len(secret) > 4 {
		parts = append(parts, secret[:4])
		secret = secret[4:]
	}
	return strings.Join(append(parts, secret), " ")
}

func (h *handler) finishTOTP(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := r.ParseForm(); err != nil {
			return &service.Error{Kind: service.Validation, Message: "Invalid form"}
		}
		if err := h.s.Auth.FinishTOTP(r.Context(), r.PostForm.Get("id"), strings.TrimSpace(r.PostForm.Get("code"))); err != nil {
			return err
		}
		// Enabling TOTP revokes every session, including this one.
		return s.redirect("/login?notice=totp-enabled")
	})
}

func (h *handler) resetTOTP(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := h.s.Auth.ResetTOTP(r.Context()); err != nil {
			return err
		}
		return s.redirect("/login?notice=totp-reset")
	})
}

func (h *handler) recoveryCodes(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		codes, err := h.s.Auth.RecoveryCodes(r.Context())
		if err != nil {
			return err
		}
		text := url.PathEscape("NelcotaDeploy recovery codes for " + mustUser(r).Email + "\n\n" + strings.Join(codes, "\n") + "\n")
		return s.patch(pages.RecoveryCodes(codes, text), "", "")
	})
}

func (h *handler) createToken(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := r.ParseForm(); err != nil {
			return &service.Error{Kind: service.Validation, Message: "Invalid form"}
		}
		ttl, _ := strconv.Atoi(r.PostForm.Get("ttl_hours"))
		token, err := h.s.Auth.CreateToken(r.Context(), service.TokenInput{Name: strings.TrimSpace(r.PostForm.Get("name")), Scopes: r.PostForm["scope"], TTLHours: ttl})
		if err != nil {
			return err
		}
		v := h.account(r)
		if err := s.patch(pages.TokensCard(h.shell(r, "", ""), v.Tokens, v.TokErr), "", ""); err != nil {
			return err
		}
		return s.patch(pages.TokenCreated(token), "", "")
	})
}

func (h *handler) revokeToken(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := h.s.Auth.RevokeToken(r.Context(), chi.URLParam(r, "id")); err != nil {
			return err
		}
		v := h.account(r)
		if err := s.patch(pages.TokensCard(h.shell(r, "", ""), v.Tokens, v.TokErr), "", ""); err != nil {
			return err
		}
		return s.toast("success", "Token revoked.")
	})
}

func mustUser(r *http.Request) service.Principal {
	p, _ := service.CurrentUser(r.Context())
	return p
}
