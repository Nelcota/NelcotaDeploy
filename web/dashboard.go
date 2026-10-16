package web

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/Nelcota/NelcotaDeploy/internal/events"
	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/Nelcota/NelcotaDeploy/web/i18n"
	"github.com/Nelcota/NelcotaDeploy/web/pages"
	"github.com/Nelcota/NelcotaDeploy/web/ui"
	"github.com/go-chi/chi/v5"
)

// appRows loads apps with their state and server name.
func (h *handler) appRows(ctx context.Context) ([]pages.AppRow, []service.Server, error) {
	apps, err := h.s.Apps.List(ctx)
	if err != nil {
		return nil, nil, err
	}
	servers, err := h.s.Servers.List(ctx)
	if err != nil {
		return nil, nil, err
	}
	names := make(map[string]string, len(servers))
	for _, s := range servers {
		names[s.ID] = s.Name
	}
	rows := make([]pages.AppRow, 0, len(apps))
	for _, a := range apps {
		deploys, err := h.s.Deploys.List(ctx, a.ID)
		if err != nil {
			return nil, nil, err
		}
		row := pages.AppRow{App: a, ServerName: names[a.ServerID], State: pages.StateOf(a, deploys)}
		row.Latest = row.State.Latest
		rows = append(rows, row)
	}
	return rows, servers, nil
}

// firstSteps is the setup checklist for administrators, derived from existing data.
func (h *handler) firstSteps(ctx context.Context, rows []pages.AppRow, servers []service.Server) []pages.Step {
	if p, _ := service.CurrentUser(ctx); p.Role != "admin" {
		return nil
	}
	passkey := false
	if f, err := h.s.Auth.Factors(ctx); err == nil {
		passkey = len(f.Passkeys) > 0
	}
	github := false
	if v, err := h.s.Settings.Get(ctx); err == nil {
		for _, k := range v.Configured {
			github = github || k == "github.app_id"
		}
	}
	online, live := false, ""
	for _, s := range servers {
		online = online || s.Status == "online"
	}
	for _, r := range rows {
		if r.State.Live.ID != "" {
			live = r.App.ID
		}
	}
	t := func(s string) string { return i18n.T(ctx, s) }
	publish := pages.Step{Label: t("Publish your first app"), Done: live != ""}
	if len(rows) > 0 && live == "" {
		publish.Href, publish.Action, publish.Hint = "/apps/"+rows[0].App.ID, t("Open"), t("Its first version goes live after the health check passes.")
	}
	return []pages.Step{
		{Label: t("Add a passkey to your account"), Hint: t("You'll use it to sign in on this and other devices."), Href: "/settings", Action: t("Add passkey"), Done: passkey},
		{Label: t("Connect GitHub"), Hint: t("Needed for private repositories and for publishing on every push."), Href: "/settings/github", Action: t("Connect"), Done: github},
		{Label: t("Add a server"), Hint: t("Copy one command and run it on your VPS."), Href: "/servers", Action: t("Add server"), Done: online},
		{Label: t("Create an app"), Hint: t("Paste a GitHub repository that has a Dockerfile."), Href: "/apps/new", Action: t("New app"), Done: len(rows) > 0},
		publish,
	}
}

// attention lists what needs a person: failed releases, offline servers, full disks.
func attention(ctx context.Context, rows []pages.AppRow, servers []service.Server, metrics map[string]pages.Metrics) []pages.Attention {
	t := func(s string) string { return i18n.T(ctx, s) }
	f := func(s string, a ...any) string { return i18n.Tf(ctx, s, a...) }
	var out []pages.Attention
	for _, r := range rows {
		switch r.State.Key {
		case "update_failed":
			out = append(out, pages.Attention{ID: "app-" + r.App.ID, Tone: "danger", Title: f("%s didn't go live", r.App.Name), Detail: f("Stopped %s, %s. The previous version is still online.", t(ui.StagePhrase(pages.FailedStage(r.Latest))), t(ui.Ago(r.Latest.FinishedAt))), Href: "/apps/" + r.App.ID, Action: t("See why")})
		case "not_live":
			out = append(out, pages.Attention{ID: "app-" + r.App.ID, Tone: "danger", Title: f("%s isn't online", r.App.Name), Detail: f("The last deployment stopped %s.", t(ui.StagePhrase(pages.FailedStage(r.Latest)))), Href: "/apps/" + r.App.ID, Action: t("See why")})
		}
	}
	for _, s := range servers {
		switch {
		case s.Status != "online":
			out = append(out, pages.Attention{ID: "server-" + s.ID, Tone: "danger", Title: f("%s is offline", s.Name), Detail: f("Its apps keep running. New deployments wait until it reconnects. Last seen %s.", t(ui.Ago(s.HeartbeatAt))), Href: "/servers", Action: t("Open servers")})
		case !s.Ready:
			out = append(out, pages.Attention{ID: "server-" + s.ID, Tone: "warning", Title: f("%s is recovering", s.Name), Detail: t("New deployments start once it has restored its state."), Href: "/servers", Action: t("Open servers")})
		}
		if m, ok := metrics[s.ID]; ok && m.DiskTotal > 0 && m.DiskUsed*100/m.DiskTotal >= 90 {
			out = append(out, pages.Attention{ID: "disk-" + s.ID, Tone: "warning", Title: f("%s disk is %d%% full", s.Name, m.DiskUsed*100/m.DiskTotal), Detail: t("Builds can fail when the disk is full."), Href: "/servers", Action: t("Free up space")})
		}
	}
	return out
}

// alerts marks rail destinations from the same rules as the attention list.
// Disk usage needs live metrics, so only the dashboard reports it.
func (h *handler) alerts(ctx context.Context) pages.Alerts {
	rows, servers, err := h.appRows(ctx)
	if err != nil {
		return pages.Alerts{}
	}
	var a pages.Alerts
	for _, item := range attention(ctx, rows, servers, nil) {
		a.Home = true
		if strings.HasPrefix(item.ID, "server-") {
			a.Servers = true
		}
	}
	return a
}

func (h *handler) dashboard(ctx context.Context, metrics map[string]pages.Metrics) pages.DashboardView {
	rows, servers, err := h.appRows(ctx)
	if err != nil {
		return pages.DashboardView{Err: publicMessage(err)}
	}
	return pages.DashboardView{Apps: rows, Servers: servers, Metrics: metrics, Steps: h.firstSteps(ctx, rows, servers), Attention: attention(ctx, rows, servers, metrics)}
}

func (h *handler) dashboardPage(w http.ResponseWriter, r *http.Request) {
	v := h.dashboard(r.Context(), nil)
	status := http.StatusOK
	if v.Err != "" {
		status = http.StatusServiceUnavailable
	}
	render(w, r, status, pages.Dashboard(h.shell(r, "Overview", "dashboard"), v))
}

func (h *handler) dashboardStream(w http.ResponseWriter, r *http.Request) {
	metrics := map[string]pages.Metrics{}
	shell := h.shell(r, "", "")
	body := func(s *stream) error {
		v := h.dashboard(r.Context(), metrics)
		if v.Err != "" {
			return &service.Error{Kind: service.Unavailable, Message: v.Err}
		}
		return s.patch(pages.DashboardBody(shell, v), "", "")
	}
	h.live(w, r, []string{"servers", "deployments", "apps"}, body, func(s *stream, ev events.Event) error {
		if ev.Kind != "server.metrics" {
			// Deployment, app, and server state changes re-render the overview from services.
			return body(s)
		}
		var sample struct {
			ServerID string        `json:"server_id"`
			Metrics  pages.Metrics `json:"metrics"`
		}
		if json.Unmarshal(ev.Data, &sample) != nil || sample.ServerID == "" {
			return nil
		}
		sample.Metrics.At = ev.Time.Unix()
		metrics[sample.ServerID] = sample.Metrics
		servers, err := h.s.Servers.List(r.Context())
		if err != nil {
			return nil
		}
		for _, srv := range servers {
			if srv.ID == sample.ServerID {
				if err := s.patch(pages.ServerCard(srv, sample.Metrics), "", ""); err != nil {
					return err
				}
			}
		}
		rows, _, err := h.appRows(r.Context())
		if err != nil {
			return nil
		}
		return s.patch(pages.AttentionList(attention(r.Context(), rows, servers, metrics)), "", "")
	}, nil)
}

func (h *handler) componentsPage(w http.ResponseWriter, r *http.Request) {
	render(w, r, http.StatusOK, pages.Gallery(h.shell(r, "Components", "")))
}

// deployApp queues a manual deployment. "latest=1" publishes the branch head
// when the panel can read the repository; otherwise, and without an explicit
// SHA, it rebuilds the newest deployed commit.
func (h *handler) deployApp(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := r.ParseForm(); err != nil {
			return invalid("Invalid form")
		}
		id := chi.URLParam(r, "id")
		app, err := h.s.Apps.Get(r.Context(), id)
		if err != nil {
			return err
		}
		sha := strings.TrimSpace(r.Form.Get("sha"))
		message := strings.TrimSpace(r.Form.Get("message"))
		head := false
		if sha == "" && r.Form.Get("latest") == "1" && h.s.Repos != nil {
			info, err := h.s.Repos.Inspect(r.Context(), service.RepoQuery{Repository: app.Repository, Branch: app.Branch, Dockerfile: app.Config.Dockerfile, InstallationID: app.Config.InstallationID})
			if err != nil {
				return err
			}
			sha, head = info.Head.SHA, true
			if message == "" {
				message = info.Head.Message
			}
		}
		if sha == "" {
			deploys, err := h.s.Deploys.List(r.Context(), id)
			if err != nil {
				return err
			}
			row := pages.AppRow{App: app}
			if len(deploys) > 0 {
				row.Latest = deploys[0]
			}
			sha = row.RedeploySHA()
			if sha == "" {
				return invalid("No previous commit to publish again. Enter a full commit SHA.")
			}
			if message == "" && row.Latest.SHA == sha {
				message = row.Latest.Message
			}
		}
		if message == "" {
			message = "Manual deployment"
		}
		clean := r.Form.Get("clean") == "true"
		d, err := h.s.Deploys.Enqueue(r.Context(), service.DeployInput{AppID: id, SHA: sha, Message: message, Author: mustUser(r).Name, Origin: "manual", Clean: clean})
		if err != nil {
			return err
		}
		if err := s.closeAndReset("main"); err != nil {
			return err
		}
		label := i18n.Tf(r.Context(), "Publishing %s at %s.", app.Name, ui.ShortSHA(d.SHA))
		switch {
		case d.Clean:
			label = i18n.Tf(r.Context(), "Clean build of %s started.", app.Name)
		case !head && r.Form.Get("latest") == "1":
			label = i18n.Tf(r.Context(), "Publishing %s again at %s. Connect GitHub to publish new commits.", app.Name, ui.ShortSHA(d.SHA))
		}
		return s.toast("success", label)
	})
}
