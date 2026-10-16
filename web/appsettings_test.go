package web_test

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func settingsForm(name string) url.Values {
	return url.Values{"name": {name}, "server_id": {"dev-server-api"}, "repository": {"https://github.com/example/" + name}, "branch": {"main"}, "dockerfile": {"Dockerfile"}, "health_path": {"/health"}, "domains": {name + ".example.org"}, "port": {"8080"}, "health_timeout": {"60"}, "replicas": {"1"}, "memory_mib": {"256"}, "cpus": {"1"}, "installation_id": {"0"}, "cache_enabled": {"true"}}
}

func TestNewAppWizardWithGitHub(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	res := s.get("/apps/new")
	mustContain(t, res.body, `id="wizard"`, "Which repository?", `name="repository"`, "Private repository?", `aria-current="step"`, "Continue")
	if res := e.member().get("/apps/new"); res.code != http.StatusForbidden {
		t.Fatal(res.code)
	}
	res = s.post("/ui/apps/new/inspect", url.Values{"repository": {"https://github.com/acme/shop"}})
	mustContain(t, res.body, `elements <div id="wizard"`, "Check the settings", "Dockerfile found", "Port 8080 read from EXPOSE", "Latest commit", `value="shop"`, `<option value="develop">`, "Create and publish", `name="publish_sha"`,
		"Environment variables", "Found in .env.example", `value="DATABASE_URL"`, `value="SECRET_KEY"`, `name="env_value"`, `type="password"`)
	res = s.post("/ui/apps/new/inspect", url.Values{"repository": {"https://gitlab.com/acme/shop"}})
	mustContain(t, res.body, "Use a GitHub address", "Which repository?")
	res = s.post("/ui/apps/new/back", url.Values{"repository": {"https://github.com/acme/shop"}})
	mustContain(t, res.body, `value="https://github.com/acme/shop"`)

	form := settingsForm("shop")
	form.Set("publish_sha", strings.Repeat("e", 40))
	form.Set("publish_message", "Add cart")
	form["env_key"] = []string{"DATABASE_URL", "SECRET_KEY"}
	form["env_value"] = []string{"postgres://db", ""}
	res = s.post("/ui/apps", form)
	mustContain(t, res.body, "location.assign", `data-redirect="/apps/`)
	apps, _ := e.services().Apps.List(withUser(e, "development-user"))
	var id string
	for _, a := range apps {
		if a.Name == "shop" {
			id = a.ID
		}
	}
	deploys, _ := e.services().Deploys.List(withUser(e, "development-user"), id)
	if id == "" || len(deploys) != 1 || deploys[0].SHA != strings.Repeat("e", 40) || deploys[0].Message != "Add cart" {
		t.Fatal(id, deploys)
	}
	// Only variables with a value are saved; empty ones are left for later.
	env, _ := e.services().Apps.Environment(withUser(e, "development-user"), id)
	if len(env) != 1 || env[0].Key != "DATABASE_URL" {
		t.Fatal(env)
	}
	mismatched := settingsForm("mismatch")
	mismatched["env_key"] = []string{"A", "B"}
	mismatched["env_value"] = []string{"1"}
	mustContain(t, s.post("/ui/apps", mismatched).body, "Invalid form")
	bad := settingsForm("bad")
	bad.Set("repository", "https://gitlab.com/x/y")
	mustContain(t, s.post("/ui/apps", bad).body, "Repository must be a GitHub HTTPS URL")
	if res := e.member().post("/ui/apps", settingsForm("nope")); !strings.Contains(res.body, "Administrator permission required") {
		t.Fatal(res.body)
	}
}

func TestNewAppWizardWithoutGitHub(t *testing.T) {
	e := newEnvWithout(t)
	res := e.admin().post("/ui/apps/new/inspect", url.Values{"repository": {"https://github.com/acme/shop"}})
	mustContain(t, res.body, "Fill these in yourself", `id="app-branch" name="branch" class="input"`, "Create app")
	mustNotContain(t, res.body, "Create and publish")
}

func TestAppSettingsPageAndSave(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	res := s.get("/apps/dev-app-api/settings")
	mustContain(t, res.body, `id="app-form"`, "General", `value="api"`, "api.example.test", "Your app listens on port", "Health check path", `id="section-advanced"`, "Advanced", "Save changes", `id="env"`, "No variables yet.", `id="runtime"`, "Stop", `id="confirm-delete"`)
	member := e.member().get("/apps/dev-app-api/settings")
	mustContain(t, member.body, "Read-only", "Configuration")
	mustNotContain(t, member.body, `id="app-form"`, `id="env"`)

	form := settingsForm("api")
	form.Set("replicas", "3")
	form.Set("domains", "api.example.test\nwww.example.test")
	res = s.post("/ui/apps/dev-app-api/settings", form)
	mustContain(t, res.body, "Settings saved.")
	app, _ := e.services().Apps.Get(withUser(e, "development-user"), "dev-app-api")
	if app.Config.Replicas != 3 || len(app.Config.Domains) != 2 || app.Revision < 2 || app.ServerID != "dev-server-api" {
		t.Fatalf("%+v", app)
	}
	form.Set("memory_mib", "abc")
	mustContain(t, s.post("/ui/apps/dev-app-api/settings", form).body, "Memory must be a whole number")
	if res := e.member().post("/ui/apps/dev-app-api/settings", settingsForm("api")); toast(res.body) != "danger" {
		t.Fatal(res.body)
	}
}

func TestEnvironmentReviewAndSecrecy(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	secret := "s3cr3t-value-should-never-render"
	res := s.post("/ui/apps/dev-app-api/env", url.Values{"key": {"DATABASE_URL"}, "value": {secret}})
	mustContain(t, res.body, `elements <section id="env"`, "DATABASE_URL", "••••••••", "DATABASE_URL saved.", "f.reset()")
	mustNotContain(t, res.body, secret)

	paste := url.Values{"dotenv": {"DATABASE_URL=new-value\nTOKEN=abc123secret\n# comment"}}
	res = s.post("/ui/apps/dev-app-api/env/preview", paste)
	mustContain(t, res.body, `elements <div id="env-review"`, `data-kind="replace"`, "DATABASE_URL", `data-kind="add"`, "TOKEN", "Save 2 change(s)", "#env-paste")
	mustNotContain(t, res.body, "abc123secret", "new-value")
	if vars, _ := e.services().Apps.Environment(withUser(e, "development-user"), "dev-app-api"); len(vars) != 1 {
		t.Fatal("preview changed the environment", vars)
	}
	res = s.post("/ui/apps/dev-app-api/env/import", paste)
	mustContain(t, res.body, "2 change(s) saved.")
	// Pruning removes keys missing from the list after review.
	prune := url.Values{"dotenv": {"TOKEN=x"}, "prune": {"true"}}
	mustContain(t, s.post("/ui/apps/dev-app-api/env/preview", prune).body, `data-kind="remove"`, "DATABASE_URL")
	s.post("/ui/apps/dev-app-api/env/import", prune)
	vars, _ := e.services().Apps.Environment(withUser(e, "development-user"), "dev-app-api")
	if len(vars) != 1 || vars[0].Key != "TOKEN" {
		t.Fatal(vars)
	}
	page := s.get("/apps/dev-app-api/settings")
	mustContain(t, page.body, `id="env-edit-TOKEN"`, `id="env-delete-TOKEN"`)
	mustNotContain(t, page.body, secret, "abc123secret")
	mustContain(t, s.post("/ui/apps/dev-app-api/env/TOKEN/delete", nil).body, "TOKEN deleted.")
	if res := s.post("/ui/apps/dev-app-api/env", url.Values{"key": {"1BAD"}, "value": {"x"}}); toast(res.body) != "danger" {
		t.Fatal(res.body)
	}
}

func TestRuntimeActionsAndDelete(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	mustContain(t, s.post("/ui/apps/dev-app-blog/delete", url.Values{"confirm_name": {"blog"}}).body, "Stop the app before deleting it")
	mustContain(t, s.post("/ui/apps/dev-app-blog/action/stop", nil).body, "blog stopped.", `elements <section id="runtime"`, "Start")
	mustContain(t, s.post("/ui/apps/dev-app-blog/delete", url.Values{"confirm_name": {"wrong"}}).body, "Type the app name exactly to confirm.")
	mustContain(t, s.post("/ui/apps/dev-app-blog/delete", url.Values{"confirm_name": {"blog"}}).body, `data-redirect="/apps"`)
	if _, err := e.services().Apps.Get(withUser(e, "development-user"), "dev-app-blog"); err == nil {
		t.Fatal("app still exists")
	}
	mustContain(t, s.post("/ui/apps/dev-app-api/action/start", nil).body, "api starting.")
	mustContain(t, s.post("/ui/apps/dev-app-api/action/restart", nil).body, "Agent unavailable")
	mustContain(t, s.post("/ui/apps/dev-app-api/action/explode", nil).body, "Invalid action")
}
