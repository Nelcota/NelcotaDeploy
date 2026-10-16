package web_test

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func photo(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 120, 80))
	for y := range 80 {
		for x := range 120 {
			img.Set(x, y, color.NRGBA{R: 40, G: 160, B: 90, A: 255})
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func (s *session) upload(path, field string, data []byte, csrf string) response {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	f, _ := w.CreateFormFile(field, "photo.png")
	_, _ = f.Write(data)
	_ = w.Close()
	r := httptest.NewRequest("POST", path, &body)
	r.Header.Set("Content-Type", w.FormDataContentType())
	r.Header.Set("Origin", origin)
	r.Header.Set("Datastar-Request", "true")
	if csrf != "" {
		r.Header.Set("X-CSRF-Token", csrf)
	}
	r.AddCookie(s.cookie)
	return s.e.do(r)
}

func TestProfilePhoto(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	page := s.get("/settings").body
	mustContain(t, page, `id="profile-photo"`, `enctype="multipart/form-data"`, `name="photo"`, "Add photo")
	mustNotContain(t, page, "Remove photo", `src="/avatars/`)

	if res := s.upload("/ui/account/avatar", "photo", photo(t), ""); res.code == http.StatusOK && toast(res.body) == "success" {
		t.Fatal("uploaded without a CSRF token")
	}
	if res := s.upload("/ui/account/avatar", "photo", []byte("<svg onload=alert(1)>"), s.csrf); toast(res.body) != "danger" {
		t.Fatal(res.body)
	}
	res := s.upload("/ui/account/avatar", "photo", photo(t), s.csrf)
	if toast(res.body) != "success" {
		t.Fatal(res.body)
	}
	mustContain(t, res.body, "Profile photo saved.", `id="profile-photo"`, `id="account-menu-right"`, `id="account-menu-down"`, `src="/avatars/development-user?v=`, "Change photo", "Remove photo")

	page = s.get("/settings").body
	i := strings.Index(page, `src="/avatars/development-user?v=`)
	if i < 0 {
		t.Fatal("photo not shown after reload")
	}
	src := page[i+5 : i+5+strings.Index(page[i+5:], `"`)]
	img := s.get(src)
	if img.code != http.StatusOK || img.header.Get("Content-Type") != "image/jpeg" || !strings.Contains(img.header.Get("Cache-Control"), "immutable") || !strings.Contains(img.header.Get("Content-Security-Policy"), "sandbox") || !bytes.HasPrefix([]byte(img.body), []byte{0xFF, 0xD8}) {
		t.Fatal(img.code, img.header)
	}
	if stale := s.get("/avatars/development-user?v=1"); stale.code != http.StatusOK || strings.Contains(stale.header.Get("Cache-Control"), "immutable") {
		t.Fatal(stale.header)
	}
	// Teammates see it; signed-out visitors don't.
	mustContain(t, e.member().get("/avatars/development-user").header.Get("Content-Type"), "image/jpeg")
	if anon := e.anon("/avatars/development-user"); anon.code != http.StatusSeeOther {
		t.Fatal(anon.code)
	}
	mustContain(t, s.get("/settings/users").body, `src="/avatars/development-user?v=`)

	res = s.post("/ui/account/avatar/remove", nil)
	mustContain(t, res.body, "Profile photo removed.", "Add photo")
	if s.get("/avatars/development-user").code != http.StatusNotFound {
		t.Fatal("photo still served")
	}
}
