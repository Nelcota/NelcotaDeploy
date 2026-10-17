package web_test

import (
	"strings"
	"testing"

	"github.com/Nelcota/NelcotaDeploy/web/static"
)

// TestImageEditorDialog checks that pages with image uploads render the editor
// dialog pointing at the fingerprinted editor.js, and that the script itself is
// not loaded with the page (app.js fetches it when someone picks an image).
func TestImageEditorDialog(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	src := static.Path("editor.js")
	if !strings.HasPrefix(src, static.Prefix+"editor.") {
		t.Fatalf("editor.js is not a fingerprinted asset: %q", src)
	}
	if res := e.anon(src); res.code != 200 {
		t.Fatalf("GET %s = %d", src, res.code)
	}
	for _, path := range []string{"/settings", "/apps/dev-app-api/settings"} {
		res := s.get(path)
		if res.code != 200 {
			t.Fatalf("GET %s = %d", path, res.code)
		}
		for _, want := range []string{
			`<dialog id="image-editor"`, `data-src="` + src + `"`, `data-ignore-morph`,
			`data-editor="zoom"`, `data-editor="saturation"`, `data-editor-preset="mono"`,
			`data-editor-action="rotate-left"`, `data-editor-action="flip"`, `data-editor-action="save"`,
			`<label for="editor-brightness"`, `<output for="editor-warmth"`,
		} {
			if !strings.Contains(res.body, want) {
				t.Errorf("%s: missing %s", path, want)
			}
		}
		if strings.Contains(res.body, `<script src="`+src) {
			t.Errorf("%s loads editor.js with the page", path)
		}
		if strings.Contains(between(res.body, `<dialog id="image-editor"`, ">"), "el.close()") {
			t.Errorf("%s: the editor closes on an outside click", path)
		}
	}
	// Pages without uploads don't carry the dialog.
	if res := s.get("/"); strings.Contains(res.body, `id="image-editor"`) {
		t.Error("home page renders the image editor")
	}
	// Members can't change logos, so their read-only app settings page has none.
	if res := e.member().get("/apps/dev-app-api/settings"); strings.Contains(res.body, `id="image-editor"`) {
		t.Error("read-only app settings render the image editor")
	}
}

func between(s, start, end string) string {
	i := strings.Index(s, start)
	if i < 0 {
		return ""
	}
	j := strings.Index(s[i:], end)
	if j < 0 {
		return s[i:]
	}
	return s[i : i+j]
}
