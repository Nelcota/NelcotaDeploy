package web_test

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestAdminSettingsPagesForbiddenToMembers(t *testing.T) {
	e := newEnv(t)
	m := e.member()
	for _, path := range []string{"/settings/users", "/settings/github", "/settings/audit", "/settings/platform"} {
		if res := m.get(path); res.code != http.StatusForbidden || !strings.Contains(res.body, "Administrator permission required") {
			t.Fatal(path, res.code)
		}
	}
	// Former pages redirect to where their content moved.
	if res := m.get("/settings/notifications"); res.code != http.StatusSeeOther || res.header.Get("Location") != "/settings" {
		t.Fatal(res.code)
	}
	if res := e.admin().get("/settings/backups"); res.code != http.StatusSeeOther || res.header.Get("Location") != "/settings/platform#backups" {
		t.Fatal(res.code)
	}
}

func TestUsersPageAndInvite(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	res := s.get("/settings/users")
	mustContain(t, res.body, "Team", "dev@localhost", "(you)", "Administrator", "Invite someone")
	res = s.post("/ui/users", url.Values{"email": {"ana@example.com"}, "name": {"Ana"}, "role": {"member"}})
	// A one-click link with the token in the fragment, and the token for manual entry.
	mustContain(t, res.body, `elements <section id="user-invite-result"`, "Invitation for Ana", `id="enrollment-link"`, "http://localhost:8080/enroll#token=", "Copy link",
		`id="enrollment-token"`, "Works for 24 hours", "They can open")
	mustNotContain(t, res.body, "data-expires=", "/enroll?token=")
	if !strings.Contains(s.get("/settings/users").body, "ana@example.com") {
		t.Fatal("user not listed")
	}
	res = s.post("/ui/users", url.Values{"email": {"not-an-email"}, "name": {"X"}, "role": {"member"}})
	mustContain(t, res.body, "Invalid user")
	if res := e.member().post("/ui/users", url.Values{"email": {"b@example.com"}, "name": {"B"}, "role": {"admin"}}); toast(res.body) != "danger" {
		t.Fatal(res.body)
	}
}

func TestGitHubSettings(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	res := s.get("/settings/github")
	mustContain(t, res.body, "Create GitHub App", `data-github-manifest`, "Not configured", "http://localhost:8080/api/webhooks/github", "/assets/settings.")
	res = s.post("/ui/settings/github", url.Values{"github.app_id": {"12345"}, "github.webhook_secret": {"whsec-very-secret"}})
	mustContain(t, res.body, `elements <section id="github-status"`, "GitHub credentials saved.")
	mustNotContain(t, res.body, "whsec-very-secret")
	page := s.get("/settings/github")
	if strings.Count(page.body, ">Configured<") != 2 {
		t.Fatal(page.body)
	}
	mustNotContain(t, page.body, "whsec-very-secret", "12345")
	if res := s.post("/ui/settings/github", url.Values{}); !strings.Contains(res.body, "Enter at least one credential") {
		t.Fatal(res.body)
	}
}

func TestTeamRolesAndRemoval(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	s.post("/ui/users", url.Values{"email": {"mia@example.com"}, "name": {"Mia"}, "role": {"member"}})
	users, _ := e.services().Users.List(withUser(e, "development-user"))
	var id string
	for _, u := range users {
		if u.Email == "mia@example.com" {
			id = u.ID
		}
	}
	page := s.get("/settings/users")
	mustContain(t, page.body, `id="role-`+id+`"`, `id="remove-user-`+id+`"`, "Remove Mia?")
	mustNotContain(t, page.body, `id="role-development-user"`, `id="remove-user-development-user"`)
	res := s.post("/ui/users/"+id+"/role", url.Values{"role": {"admin"}})
	mustContain(t, res.body, `elements <section id="team"`, "Role changed to administrator.")
	mustContain(t, s.post("/ui/users/development-user/role", url.Values{"role": {"member"}}).body, "You can")
	res = s.post("/ui/users/"+id+"/remove", nil)
	mustContain(t, res.body, "Removed.")
	mustNotContain(t, res.body, "mia@example.com")
	if res := e.member().post("/ui/users/development-user/remove", nil); toast(res.body) != "danger" {
		t.Fatal(res.body)
	}
}

func TestConnectionsAndSystem(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	mustContain(t, s.get("/settings/github").body, "Connections", "Create GitHub App", "S3 storage", "Not configured", `name="secret_key"`)
	page := s.get("/settings/platform")
	mustContain(t, page.body, "System", `id="backups"`, "Back up now", "Updates", "Recent operations", "No operations yet.")
	res := s.post("/ui/operations/backup", nil)
	mustContain(t, res.body, `elements <div id="operations"`, "Waiting", "Backup started.", "data-on-interval__duration.4s")
	mustContain(t, s.post("/ui/operations/backup", nil).body, "Backup already pending")
	mustContain(t, s.get("/ui/operations").body, `elements <div id="operations"`, "Backup")
	res = s.post("/ui/settings/backup-s3", url.Values{"endpoint": {"https://s3.example.com"}, "region": {"eu-1"}, "bucket": {"b"}, "access_key": {"AKIA"}, "secret_key": {"super-secret-key"}})
	mustContain(t, res.body, "S3 configuration saved.", `elements <section id="s3"`, ">Configured<")
	mustNotContain(t, res.body, "super-secret-key")
	mustContain(t, s.post("/ui/settings/backup-s3", url.Values{"endpoint": {"http://insecure"}, "region": {"r"}, "bucket": {"b"}, "access_key": {"a"}, "secret_key": {"s"}}).body, "Invalid S3 configuration")
	if _, err := e.core.DB.Write.ExecContext(e.ctx, "UPDATE sessions SET two_factor_at=?", time.Now().Add(-time.Hour).Unix()); err != nil {
		t.Fatal(err)
	}
	mustContain(t, s.post("/ui/operations/update", url.Values{"version": {"v9.0.0"}}).body, `"_reauth":true`)
}

func TestPlatformUpdateAndCancel(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	res := s.get("/settings/platform")
	mustContain(t, res.body, "Current version: <span class=\"mono\">v1.2.3</span>", `id="update-form"`, `id="confirm-update"`, "#update-form")
	res = s.post("/ui/operations/update", url.Values{"version": {"v1.0.0"}})
	mustContain(t, res.body, "Version must be newer than the installed version")
	res = s.post("/ui/operations/update", url.Values{"version": {"v1.3.0"}})
	mustContain(t, res.body, "Update to v1.3.0 is waiting to start.", "Update to <span class=\"mono\">v1.3.0</span>", "panel", "Cancel batch")
	ops, _ := e.core.Operations.List(withUser(e, "development-user"))
	if len(ops) == 0 {
		t.Fatal("no operations")
	}
	res = s.post("/ui/operations/"+ops[0].Batch+"/cancel", nil)
	mustContain(t, res.body, "Batch cancelled.", "Cancelled")
	res = s.post("/ui/operations/"+ops[0].Batch+"/cancel", nil)
	mustContain(t, res.body, "Pending operation not found")
}

func TestAuditFilters(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	s.post("/ui/apps/dev-app-api/deploy", nil)
	s.post("/ui/users", url.Values{"email": {"zoe@example.com"}, "name": {"Zoe"}, "role": {"member"}})
	res := s.get("/settings/audit")
	mustContain(t, res.body, "deploy.enqueue", "user.create", "auth.login", "Development", `value="deploy.enqueue"`, " entries",
		// Actions read as words; the code stays in the title.
		"Started publishing", `title="deploy.enqueue"`, "Invited someone", "Signed in")
	mustNotContain(t, res.body, "matching entries among")
	mustNotContain(t, res.body, ">http.request<")
	res = s.get("/settings/audit?action=deploy.enqueue")
	mustContain(t, res.body, "deploy.enqueue")
	mustNotContain(t, res.body, "<td class=\"mono\">user.create</td>")
	res = s.get("/settings/audit?http=1")
	mustContain(t, res.body, "http.request", "/ui/apps/{id}/deploy")
	res = s.get("/settings/audit?user=nobody")
	mustContain(t, res.body, "No matching entries")
	res = s.get("/settings/audit?target=" + url.QueryEscape("<script>"))
	mustNotContain(t, res.body, "<script>\"")
}

func TestSystemPageExplainsUpdateChecks(t *testing.T) {
	e := newEnv(t)
	body := e.admin().get("/settings/platform").body
	mustContain(t, body, `id="updates"`, "Automatic checks need a release identity", "Install a specific version", `id="update-version"`, `id="confirm-update"`)
	// Without a release identity there is nothing to turn on.
	mustNotContain(t, body, `name="automatic"`)
	if res := e.member().get("/settings/platform"); res.code != http.StatusForbidden {
		t.Fatal(res.code)
	}
}
