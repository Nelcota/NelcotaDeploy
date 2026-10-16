package web_test

import (
	"net/http"
	"net/url"
	"testing"
)

func TestNotificationsCard(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	page := s.get("/settings/github").body
	mustContain(t, page, `id="notifications"`, `name="webhook_url"`, `name="smtp_host"`, "Notify me when", `value="deploy.failed"`, "Send a test")

	form := url.Values{
		"webhook_url":   {"https://hooks.slack.com/services/T0/B0/very-secret-token"},
		"smtp_host":     {"smtp.example.com"},
		"smtp_port":     {"587"},
		"smtp_username": {"bot"},
		"smtp_password": {"smtp-secret-password"},
		"smtp_from":     {"panel@example.com"},
		"smtp_to":       {"ops@example.com, dev@example.com"},
		"event":         {"deploy.failed", "server.offline"},
	}
	res := s.post("/ui/settings/notifications", form)
	if toast(res.body) != "success" {
		t.Fatal(res.body)
	}
	mustContain(t, res.body, "Notifications saved.", `data-tone="success">Slack`, `<span class="mono">hooks.slack.com</span>`, `value="smtp.example.com"`, `value="ops@example.com, dev@example.com"`)
	page = s.get("/settings/github").body
	mustNotContain(t, page, "very-secret-token", "smtp-secret-password")
	mustNotContain(t, res.body, "very-secret-token", "smtp-secret-password")
	// Unchecked events are muted.
	mustContain(t, page, `value="deploy.failed" checked`)
	mustNotContain(t, page, `value="disk.full" checked`)

	bad := url.Values{"webhook_url": {"https://169.254.169.254/latest/meta-data"}}
	if res := s.post("/ui/settings/notifications", bad); toast(res.body) != "danger" {
		t.Fatal("accepted a metadata address", res.body)
	}
	if res := s.postWith("/ui/settings/notifications", form, ""); res.code == http.StatusOK && toast(res.body) == "success" {
		t.Fatal("saved without CSRF")
	}
	if res := e.member().post("/ui/settings/notifications", form); toast(res.body) != "danger" {
		t.Fatal("member changed notifications")
	}
	res = s.post("/ui/settings/notifications/webhook/remove", nil)
	mustContain(t, res.body, "Webhook removed.")
	mustNotContain(t, res.body, `data-tone="success">Slack`)
}
