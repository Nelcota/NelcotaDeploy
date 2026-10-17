package web_test

import (
	"net/http"
	"strings"
	"testing"
)

// TestRuntimeMarks checks that an app's language shows as its official mark
// where the app has no uploaded logo, and can be changed in settings.
func TestRuntimeMarks(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	// The development api app is a Go app: its mark replaces the initial.
	for _, path := range []string{"/", "/apps", "/apps/dev-app-api", "/servers"} {
		res := s.get(path)
		if res.code != http.StatusOK {
			t.Fatal(path, res.code)
		}
		mustContain(t, res.body, `aria-label="Go"`, `fill="#00ADD8"`)
	}
	settings := s.get("/apps/dev-app-api/settings").body
	mustContain(t, settings, `name="runtime"`, `<option value="go" selected>Go</option>`, `<option value="node">Node.js</option>`, `<option value="java">OpenJDK</option>`)

	// Saving another runtime switches the mark; the stored value is checked by
	// the service, so an unknown one is refused.
	form := settingsForm("api")
	form.Set("runtime", "rust")
	if res := s.post("/ui/apps/dev-app-api/settings", form); toast(res.body) == "danger" {
		t.Fatal(res.body)
	}
	mustContain(t, s.get("/apps/dev-app-api").body, `aria-label="Rust"`, `fill="currentColor"`)
	form.Set("runtime", "cobol")
	if res := s.post("/ui/apps/dev-app-api/settings", form); toast(res.body) != "danger" || !strings.Contains(res.body, "Unknown runtime") {
		t.Fatal(res.body)
	}
	// A form without the field keeps the stored runtime.
	form.Del("runtime")
	if res := s.post("/ui/apps/dev-app-api/settings", form); toast(res.body) == "danger" {
		t.Fatal(res.body)
	}
	mustContain(t, s.get("/apps/dev-app-api").body, `aria-label="Rust"`)
}
