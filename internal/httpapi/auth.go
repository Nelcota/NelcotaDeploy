package httpapi

import (
	"net/http"

	"github.com/Nelcota/NelcotaDeploy/internal/service"
)

func (a *API) verifyRecovery(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Challenge string `json:"challenge"`
		Code      string `json:"code"`
	}
	if !read(w, r, &in) {
		return
	}
	v, e := a.cfg.Services.Auth.VerifyRecovery(r.Context(), in.Challenge, in.Code)
	if e == nil {
		a.cookie(w, v)
	}
	respond(w, v, e)
}
func (a *API) beginRegistration(w http.ResponseWriter, r *http.Request) {
	var in service.RegistrationInput
	if !read(w, r, &in) {
		return
	}
	v, e := a.cfg.Services.Auth.BeginRegistration(r.Context(), in)
	respond(w, v, e)
}
func (a *API) finishRegistration(w http.ResponseWriter, r *http.Request) {
	var in service.FinishInput
	if !read(w, r, &in) {
		return
	}
	e := a.cfg.Services.Auth.FinishRegistration(r.Context(), in)
	respond(w, map[string]bool{"ok": e == nil}, e)
}
func (a *API) beginLogin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	if !read(w, r, &in) {
		return
	}
	v, e := a.cfg.Services.Auth.BeginLogin(r.Context(), in.Email)
	respond(w, v, e)
}
func (a *API) finishLogin(w http.ResponseWriter, r *http.Request) {
	var in service.FinishInput
	if !read(w, r, &in) {
		return
	}
	v, e := a.cfg.Services.Auth.FinishLogin(r.Context(), in)
	if e == nil && v.Token != "" {
		a.cookie(w, v)
	}
	respond(w, v, e)
}
func (a *API) verifyTOTP(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Challenge string `json:"challenge"`
		Code      string `json:"code"`
	}
	if !read(w, r, &in) {
		return
	}
	v, e := a.cfg.Services.Auth.VerifyTOTP(r.Context(), in.Challenge, in.Code)
	if e == nil {
		a.cookie(w, v)
	}
	respond(w, v, e)
}
func (a *API) devSession(w http.ResponseWriter, r *http.Request) {
	v, e := a.cfg.DevelopmentLogin(r.Context())
	if e == nil {
		a.cookie(w, v)
	}
	respond(w, map[string]bool{"ok": e == nil}, e)
}

// sessionToken is the session cookie's value, empty without one.
func (a *API) sessionToken(r *http.Request) string {
	c, _ := r.Cookie(a.cookieName())
	if c == nil {
		return ""
	}
	return c.Value
}
func (a *API) currentSession(w http.ResponseWriter, r *http.Request) {
	p, e := service.CurrentUser(r.Context())
	respond(w, map[string]any{"user": p, "csrf_token": a.csrfToken(a.sessionToken(r))}, e)
}
func (a *API) logout(w http.ResponseWriter, r *http.Request) {
	e := a.cfg.Services.Auth.Logout(r.Context(), a.sessionToken(r))
	http.SetCookie(w, &http.Cookie{
		Name: a.cookieName(), Value: "", Path: "/", HttpOnly: true,
		Secure: !a.cfg.Dev, SameSite: http.SameSiteStrictMode, MaxAge: -1,
	})
	respond(w, map[string]bool{"ok": e == nil}, e)
}
func (a *API) recoveryCodes(w http.ResponseWriter, r *http.Request) {
	v, e := a.cfg.Services.Auth.RecoveryCodes(r.Context())
	respond(w, map[string]any{"codes": v}, e)
}
func (a *API) resetTOTP(w http.ResponseWriter, r *http.Request) {
	e := a.cfg.Services.Auth.ResetTOTP(r.Context())
	respond(w, map[string]bool{"ok": e == nil}, e)
}
func (a *API) beginTOTP(w http.ResponseWriter, r *http.Request) {
	v, e := a.cfg.Services.Auth.BeginTOTP(r.Context())
	respond(w, v, e)
}
func (a *API) finishTOTP(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID   string `json:"id"`
		Code string `json:"code"`
	}
	if !read(w, r, &in) {
		return
	}
	e := a.cfg.Services.Auth.FinishTOTP(r.Context(), in.ID, in.Code)
	respond(w, map[string]bool{"ok": e == nil}, e)
}
