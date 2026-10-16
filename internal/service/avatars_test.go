package service

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func pngOf(t *testing.T, w, h int, fill color.Color) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.Set(x, y, fill)
		}
	}
	var b bytes.Buffer
	if e := png.Encode(&b, img); e != nil {
		t.Fatal(e)
	}
	return b.Bytes()
}

func TestAvatarLifecycle(t *testing.T) {
	c, ctx, _ := fixture(t)
	a := &AuthService{Core: c}
	if _, e := c.DB.Write.ExecContext(ctx, "INSERT INTO users(id,email,name,role,created_at) VALUES('admin','a@example.com','A','admin',0),('m','m@example.com','M','member',0)"); e != nil {
		t.Fatal(e)
	}
	if _, e := a.Avatar(ctx, "admin"); !Is(e, NotFound) {
		t.Fatal(e)
	}
	// A wide, partly transparent image becomes a centered 256 px square JPEG.
	if e := a.SetAvatar(ctx, pngOf(t, 600, 300, color.NRGBA{R: 200, A: 128})); e != nil {
		t.Fatal(e)
	}
	v, e := a.Avatar(WithPrincipal(ctx, Principal{ID: "m", Role: "member"}), "admin")
	if e != nil || v.UpdatedAt == 0 {
		t.Fatal(v.UpdatedAt, e)
	}
	img, e := jpeg.Decode(bytes.NewReader(v.Image))
	if e != nil || img.Bounds().Dx() != AvatarSize || img.Bounds().Dy() != AvatarSize {
		t.Fatal(e, img)
	}
	// The listing and the session carry the version used for caching.
	users, _ := a.List(ctx)
	for _, u := range users {
		if (u.ID == "admin") != (u.AvatarAt == v.UpdatedAt) {
			t.Fatalf("%+v", u)
		}
	}
	var audit int
	_ = c.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM audit_log WHERE action='user.avatar.set' AND target='admin'").Scan(&audit)
	if audit != 1 {
		t.Fatal("not audited")
	}

	if e := a.RemoveAvatar(ctx); e != nil {
		t.Fatal(e)
	}
	if _, e := a.Avatar(ctx, "admin"); !Is(e, NotFound) {
		t.Fatal(e)
	}
	// Photos go away with their owner.
	if e := a.SetAvatar(WithPrincipal(ctx, Principal{ID: "m", Role: "member"}), pngOf(t, 64, 64, color.Black)); e != nil {
		t.Fatal(e)
	}
	if e := a.Remove(ctx, "m"); e != nil {
		t.Fatal(e)
	}
	var left int
	_ = c.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM avatars").Scan(&left)
	if left != 0 {
		t.Fatal("photo kept after removal")
	}
}

func TestAvatarRejectsBadUploads(t *testing.T) {
	c, ctx, _ := fixture(t)
	a := &AuthService{Core: c}
	if _, e := c.DB.Write.ExecContext(ctx, "INSERT INTO users(id,email,name,role,created_at) VALUES('admin','a@example.com','A','admin',0)"); e != nil {
		t.Fatal(e)
	}
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)
	for name, upload := range map[string][]byte{
		"empty":     nil,
		"svg":       svg,
		"text":      []byte("hello"),
		"tiny":      pngOf(t, 8, 8, color.White),
		"too big":   make([]byte, AvatarMaxBytes+1),
		"huge":      hugePNGHeader(t),
		"truncated": pngOf(t, 100, 100, color.White)[:60],
	} {
		if e := a.SetAvatar(ctx, upload); !Is(e, Validation) {
			t.Errorf("%s: %v", name, e)
		}
	}
	if e := a.SetAvatar(WithPrincipal(ctx, Principal{ID: "admin", Role: "admin", Scopes: []string{"users:write"}}), pngOf(t, 64, 64, color.White)); !Is(e, Forbidden) {
		t.Fatal("API token changed a photo", e)
	}
}

// hugePNGHeader is a valid PNG header that claims 30000×30000 pixels; it must
// be rejected from its dimensions alone.
func hugePNGHeader(t *testing.T) []byte {
	b := pngOf(t, 40, 40, color.White)
	// IHDR width and height start at byte 16.
	copy(b[16:24], []byte{0, 0, 0x75, 0x30, 0, 0, 0x75, 0x30})
	return b
}
