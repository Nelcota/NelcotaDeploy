package web_test

import (
	"net/http"
	"strings"
	"testing"
)

func TestCommandPalette(t *testing.T) {
	e := newEnv(t)
	res := e.admin().get("/ui/cmdk")
	if res.code != http.StatusOK || !strings.HasPrefix(res.header.Get("Content-Type"), "text/html") {
		t.Fatal(res.code, res.header)
	}
	mustContain(t, res.body, `role="option"`, `role="group"`, ">Go to<", ">Apps<", ">Publish<", ">Actions<", `data-href="/apps/dev-app-api"`, `data-href="/apps/dev-app-api/deployments"`, `data-href="/apps/dev-app-api/logs?deployment=runtime"`, "Publish api", "@post(&#34;/ui/apps/dev-app-api/deploy?latest=1&#34;", `data-theme-set="dark"`, "data-logout", `data-href="/settings/audit"`, "New app")
	// Buttons without an action carry no empty Datastar attribute.
	mustNotContain(t, res.body, `data-on:click=""`, "<a ", "<button")
	member := e.member().get("/ui/cmdk")
	mustContain(t, member.body, "Publish api", `data-href="/settings"`)
	mustNotContain(t, member.body, `data-href="/settings/audit"`, "New app", "Invite user")
	if r := e.anon("/ui/cmdk"); r.code != http.StatusUnauthorized {
		t.Fatal(r.code)
	}
}
