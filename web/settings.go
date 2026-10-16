package web

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"

	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/Nelcota/NelcotaDeploy/web/i18n"
	"github.com/Nelcota/NelcotaDeploy/web/pages"
	"github.com/go-chi/chi/v5"
)

// adminPage renders a 403 page for members; services enforce the same rule.
func (h *handler) adminPage(w http.ResponseWriter, r *http.Request) bool {
	if mustUser(r).Role == "admin" {
		return true
	}
	h.failPage(w, r, "settings", &service.Error{Kind: service.Forbidden, Message: "Administrator permission required"})
	return false
}

func (h *handler) usersPage(w http.ResponseWriter, r *http.Request) {
	if !h.adminPage(w, r) {
		return
	}
	users, err := h.s.Users.List(r.Context())
	msg := ""
	if err != nil {
		msg = publicMessage(err)
	}
	render(w, r, http.StatusOK, pages.Users(h.shell(r, "Users", "settings"), users, msg))
}

func (h *handler) inviteUser(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := r.ParseForm(); err != nil {
			return invalid("Invalid form")
		}
		name, email := strings.TrimSpace(r.PostForm.Get("name")), strings.TrimSpace(r.PostForm.Get("email"))
		en, err := h.s.Users.Create(r.Context(), service.UserInput{Email: email, Name: name, Role: r.PostForm.Get("role")})
		if err != nil {
			return err
		}
		// With email configured, the invitation is sent too; the token stays on
		// screen either way, so a failed email never blocks the invitation.
		sent := pages.InviteDelivery{}
		if h.s.Notifications != nil && h.s.Notifications.EmailConfigured(r.Context()) {
			if err := h.s.Notifications.SendInvitation(r.Context(), email, name, en.Token); err != nil {
				sent.Err = publicMessage(err)
			} else {
				sent.To = email
			}
		}
		if err := s.patch(pages.UserInvite(name, en, h.cfg.Origin, sent), "", ""); err != nil {
			return err
		}
		if users, err := h.s.Users.List(r.Context()); err == nil {
			if err := s.patch(pages.TeamList(h.shell(r, "", ""), users), "", ""); err != nil {
				return err
			}
		}
		return s.closeAndReset("#invite-user")
	})
}

func (h *handler) teamUpdate(s *stream, r *http.Request, message string) error {
	users, err := h.s.Users.List(r.Context())
	if err != nil {
		return err
	}
	if err := s.patch(pages.TeamList(h.shell(r, "", ""), users), "", ""); err != nil {
		return err
	}
	return s.toast("success", message)
}

func (h *handler) setUserRole(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := r.ParseForm(); err != nil {
			return invalid("Invalid form")
		}
		role := r.PostForm.Get("role")
		if err := h.s.Users.SetRole(r.Context(), chi.URLParam(r, "id"), role); err != nil {
			return err
		}
		return h.teamUpdate(s, r, i18n.Tf(r.Context(), "Role changed to %s.", strings.ToLower(i18n.T(r.Context(), pages.RoleLabel(role)))))
	})
}

func (h *handler) removeUser(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := h.s.Users.Remove(r.Context(), chi.URLParam(r, "id")); err != nil {
			return err
		}
		return h.teamUpdate(s, r, "Removed.")
	})
}

func (h *handler) configured(r *http.Request) (map[string]bool, error) {
	view, err := h.s.Settings.Get(r.Context())
	m := map[string]bool{}
	for _, k := range view.Configured {
		m[k] = true
	}
	return m, err
}

func (h *handler) githubPage(w http.ResponseWriter, r *http.Request) {
	if !h.adminPage(w, r) {
		return
	}
	v := pages.GitHubView{Origin: h.cfg.Origin}
	// Set by the GitHub App callback and GitHub's post-installation redirect.
	switch r.URL.Query().Get("github") {
	case "installed", "failed":
		v.Result = r.URL.Query().Get("github")
	}
	var err error
	if v.Configured, err = h.configured(r); err != nil {
		v.Err = publicMessage(err)
	}
	if h.s.Notifications != nil {
		if n, err := h.s.Notifications.Get(r.Context()); err == nil {
			v.Notify = &n
		} else {
			v.Err = publicMessage(err)
		}
	}
	s := h.shell(r, "Connections", "settings")
	s.Scripts = append(s.Scripts, "settings.js")
	render(w, r, http.StatusOK, pages.GitHub(s, v, v.Configured["backup.s3"]))
}

// saveGitHub stores only the credentials that were filled in.
func (h *handler) saveGitHub(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := r.ParseForm(); err != nil {
			return invalid("Invalid form")
		}
		saved := 0
		for _, key := range []string{"github.app_id", "github.client_id", "github.private_key", "github.webhook_secret", "github.client_secret"} {
			value := strings.TrimSpace(r.PostForm.Get(key))
			if value == "" {
				continue
			}
			if err := h.s.Settings.Set(r.Context(), key, value); err != nil {
				return err
			}
			saved++
		}
		if saved == 0 {
			return invalid("Enter at least one credential to save.")
		}
		configured, err := h.configured(r)
		if err != nil {
			return err
		}
		if err := s.patch(pages.GitHubCredentials(pages.GitHubView{Configured: configured, Origin: h.cfg.Origin}), "", ""); err != nil {
			return err
		}
		if err := s.closeAndReset("#github-status"); err != nil {
			return err
		}
		return s.toast("success", "GitHub credentials saved.")
	})
}

// notificationsPage and backupsPage moved into Account and System.
func (h *handler) notificationsPage(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/settings", http.StatusSeeOther)
}

func (h *handler) operations(r *http.Request, kind string) pages.OperationsView {
	ops, err := h.s.Operations.List(r.Context())
	v := pages.OperationsView{Operations: ops, Kind: kind}
	if err != nil {
		v.Err = publicMessage(err)
	}
	return v
}

func (h *handler) backupsPage(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/settings/platform#backups", http.StatusSeeOther)
}

// s3Config reads the S3 form as the JSON the settings service stores.
func s3Config(r *http.Request) (string, error) {
	if err := r.ParseForm(); err != nil {
		return "", invalid("Invalid form")
	}
	cfg := map[string]string{}
	for _, k := range []string{"endpoint", "region", "bucket", "prefix", "access_key", "secret_key", "session_token"} {
		if v := strings.TrimSpace(r.PostForm.Get(k)); v != "" {
			cfg[k] = v
		}
	}
	b, err := json.Marshal(cfg)
	return string(b), err
}

// testS3 checks the filled-in form before it is saved.
func (h *handler) testS3(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		cfg, err := s3Config(r)
		if err != nil {
			return err
		}
		if err := h.s.Settings.TestS3(r.Context(), cfg); err != nil {
			return err
		}
		return s.toast("success", i18n.T(r.Context(), "S3 works: a test file was stored and deleted."))
	})
}

func (h *handler) saveS3(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		cfg, err := s3Config(r)
		if err != nil {
			return err
		}
		if err := h.s.Settings.Set(r.Context(), "backup.s3", cfg); err != nil {
			return err
		}
		if err := s.patch(pages.S3Card(true), "", ""); err != nil {
			return err
		}
		if err := s.closeAndReset("#s3"); err != nil {
			return err
		}
		return s.toast("success", "S3 configuration saved.")
	})
}

func (h *handler) startBackup(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if _, err := h.s.Operations.Backup(r.Context()); err != nil {
			return err
		}
		if err := s.patch(pages.OperationsTable(h.operations(r, "")), "", ""); err != nil {
			return err
		}
		return s.toast("success", "Backup started.")
	})
}

func (h *handler) startUpdate(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := r.ParseForm(); err != nil {
			return invalid("Invalid form")
		}
		version := strings.TrimSpace(r.PostForm.Get("version"))
		if _, err := h.s.Operations.Update(r.Context(), version); err != nil {
			return err
		}
		if err := s.patch(pages.OperationsTable(h.operations(r, "")), "", ""); err != nil {
			return err
		}
		return s.toast("success", i18n.Tf(r.Context(), "Update to %s queued.", version))
	})
}

func (h *handler) cancelOperation(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := h.s.Operations.Cancel(r.Context(), chi.URLParam(r, "batch")); err != nil {
			return err
		}
		if err := s.patch(pages.OperationsTable(h.operations(r, "")), "", ""); err != nil {
			return err
		}
		return s.toast("success", "Batch cancelled.")
	})
}

// operationsFragment refreshes the operations table while jobs run (no SSE exists for operations).
func (h *handler) operationsFragment(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("kind")
	if kind != "backup" {
		kind = ""
	}
	_ = newStream(w, r).patch(pages.OperationsTable(h.operations(r, kind)), "", "")
}

func (h *handler) platformPage(w http.ResponseWriter, r *http.Request) {
	if !h.adminPage(w, r) {
		return
	}
	u, err := h.s.Operations.Updates(r.Context())
	if err != nil {
		h.failPage(w, r, "settings", err)
		return
	}
	render(w, r, http.StatusOK, pages.Platform(h.shell(r, "Platform", "settings"), u, h.operations(r, "")))
}

func (h *handler) setAutomaticUpdates(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := r.ParseForm(); err != nil {
			return invalid("Invalid form")
		}
		on := r.PostForm.Get("automatic") == "true"
		if err := h.s.Operations.SetAutomaticUpdates(r.Context(), on); err != nil {
			return err
		}
		u, err := h.s.Operations.Updates(r.Context())
		if err != nil {
			return err
		}
		if err := s.patch(pages.UpdatesCard(u), "", ""); err != nil {
			return err
		}
		if on {
			return s.toast("success", i18n.T(r.Context(), "Updates will install automatically."))
		}
		return s.toast("success", i18n.T(r.Context(), "Automatic updates are off."))
	})
}

// auditPage filters the newest 1000 entries. Filtering is presentation only; the
// service returns the entries the administrator is allowed to read.
func (h *handler) auditPage(w http.ResponseWriter, r *http.Request) {
	if !h.adminPage(w, r) {
		return
	}
	q := r.URL.Query()
	v := pages.AuditView{Filter: pages.AuditFilter{Action: q.Get("action"), User: q.Get("user"), Target: strings.TrimSpace(q.Get("target")), HTTP: q.Get("http") == "1"}, Users: map[string]string{"system": "System", "anonymous": "Anonymous"}}
	entries, err := h.s.Audit.List(r.Context(), 1000)
	if err != nil {
		v.Err = publicMessage(err)
	}
	if people, err := h.s.Users.List(r.Context()); err == nil {
		v.People = people
		for _, p := range people {
			v.Users[p.ID] = p.Name
		}
	}
	v.Total = len(entries)
	seen := map[string]bool{}
	for _, a := range entries {
		if !seen[a.Action] && (a.Action != "http.request" || v.Filter.HTTP) {
			seen[a.Action] = true
			v.Actions = append(v.Actions, a.Action)
		}
		if a.Action == "http.request" && !v.Filter.HTTP && v.Filter.Action != "http.request" {
			continue
		}
		if (v.Filter.Action != "" && a.Action != v.Filter.Action) || (v.Filter.User != "" && a.UserID != v.Filter.User) || (v.Filter.Target != "" && !strings.Contains(strings.ToLower(a.Target), strings.ToLower(v.Filter.Target))) {
			continue
		}
		v.Matching++
		if len(v.Entries) < 200 {
			v.Entries = append(v.Entries, a)
		}
	}
	slices.Sort(v.Actions)
	render(w, r, http.StatusOK, pages.Audit(h.shell(r, "Audit log", "settings"), v))
}
