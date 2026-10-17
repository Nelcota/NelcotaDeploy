package service

import (
	"bytes"
	"image/color"
	"image/png"
	"testing"
)

func TestLogoLifecycle(t *testing.T) {
	c, ctx, app := fixture(t)
	s := &appsService{c}
	if _, e := s.Logo(ctx, app.ID); !Is(e, NotFound) {
		t.Fatal(e)
	}
	// A wide, partly transparent image is fitted, not cropped, into a 256 px PNG.
	if e := s.SetLogo(ctx, app.ID, pngOf(t, 600, 300, color.NRGBA{R: 200, A: 128})); e != nil {
		t.Fatal(e)
	}
	v, e := s.Logo(WithPrincipal(ctx, Principal{ID: "m", Role: "member"}), app.ID)
	if e != nil || v.UpdatedAt == 0 {
		t.Fatal(v.UpdatedAt, e)
	}
	img, e := png.Decode(bytes.NewReader(v.Image))
	if e != nil || img.Bounds().Dx() != LogoSize || img.Bounds().Dy() != LogoSize {
		t.Fatal(e, img)
	}
	if _, _, _, a := img.At(LogoSize/2, 0).RGBA(); a != 0 {
		t.Fatal("letterbox is not transparent")
	}
	if _, _, _, a := img.At(LogoSize/2, LogoSize/2).RGBA(); a == 0 {
		t.Fatal("logo is missing")
	}
	// The listing and a single app carry the version used for caching.
	apps, _ := s.List(ctx)
	got, _ := s.Get(ctx, app.ID)
	if len(apps) != 1 || apps[0].LogoAt != v.UpdatedAt || got.LogoAt != v.UpdatedAt {
		t.Fatal(apps, got)
	}
	var audit int
	_ = c.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM audit_log WHERE action='app.logo.set' AND target=?", app.ID).Scan(&audit)
	if audit != 1 {
		t.Fatal("not audited")
	}
	if e := s.RemoveLogo(ctx, app.ID); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Logo(ctx, app.ID); !Is(e, NotFound) {
		t.Fatal(e)
	}
}

func TestLogoRules(t *testing.T) {
	c, ctx, app := fixture(t)
	s := &appsService{c}
	member := WithPrincipal(ctx, Principal{ID: "m", Role: "member"})
	if e := s.SetLogo(member, app.ID, pngOf(t, 64, 64, color.White)); !Is(e, Forbidden) {
		t.Fatal("members can't change logos", e)
	}
	if e := s.RemoveLogo(member, app.ID); !Is(e, Forbidden) {
		t.Fatal("members can't remove logos", e)
	}
	if e := s.SetLogo(ctx, "missing", pngOf(t, 64, 64, color.White)); !Is(e, NotFound) {
		t.Fatal(e)
	}
	for _, bad := range [][]byte{nil, []byte("not an image"), pngOf(t, 16, 16, color.White)} {
		if e := s.SetLogo(ctx, app.ID, bad); !Is(e, Validation) {
			t.Fatal(e)
		}
	}
	// Deleting the app deletes its logo.
	if e := s.SetLogo(ctx, app.ID, pngOf(t, 64, 64, color.White)); e != nil {
		t.Fatal(e)
	}
	if _, e := c.DB.Write.ExecContext(ctx, "DELETE FROM apps WHERE id=?", app.ID); e != nil {
		t.Fatal(e)
	}
	var n int
	_ = c.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM app_logos").Scan(&n)
	if n != 0 {
		t.Fatal("logo outlived its app")
	}
}
