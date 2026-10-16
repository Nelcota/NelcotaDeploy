package web

import (
	"net/http"

	"github.com/Nelcota/NelcotaDeploy/web/i18n"
	"github.com/Nelcota/NelcotaDeploy/web/pages"
	"github.com/Nelcota/NelcotaDeploy/web/ui"
	"github.com/a-h/templ"
)

// commandPalette returns palette entries for the viewer: pages, apps, and actions.
// Administrator-only entries are omitted for members; services still enforce roles.
func (h *handler) commandPalette(w http.ResponseWriter, r *http.Request) {
	admin := mustUser(r).Role == "admin"
	nav := []pages.Command{
		{Label: "Home", Icon: "layout-dashboard", Href: "/", Keywords: "overview dashboard attention"},
		{Label: "Apps", Icon: "box", Href: "/apps"},
		{Label: "Servers", Icon: "server", Href: "/servers", Keywords: "metrics cache"},
		{Label: "Account", Hint: "Settings", Icon: "fingerprint", Href: "/settings", Keywords: "passkeys two-factor totp tokens"},
	}
	if admin {
		nav = append(nav,
			pages.Command{Label: "Team", Hint: "Settings", Icon: "users", Href: "/settings/users", Keywords: "users invite roles"},
			pages.Command{Label: "Connections", Hint: "Settings", Icon: "plug", Href: "/settings/github", Keywords: "github webhook s3"},
			pages.Command{Label: "Activity", Hint: "Settings", Icon: "history", Href: "/settings/audit", Keywords: "audit log"},
			pages.Command{Label: "System", Hint: "Settings", Icon: "circle-arrow-up", Href: "/settings/platform", Keywords: "backup update version"},
		)
	}
	groups := []pages.CommandGroup{{Label: "Go to", Commands: translated(r, nav)}}

	rows, _, err := h.appRows(r.Context())
	if err == nil && len(rows) > 0 {
		var apps, deploys []pages.Command
		for _, row := range rows {
			a := row.App
			base := "/apps/" + a.ID
			apps = append(apps,
				pages.Command{Label: a.Name, Hint: "Overview", Icon: "activity", Href: base, Keywords: a.Repository},
				pages.Command{Label: a.Name, Hint: "History", Icon: "history", Href: base + "/deployments", Keywords: "deployments releases"},
				pages.Command{Label: a.Name, Hint: "Build logs", Icon: "scroll-text", Href: base + "/logs"},
				pages.Command{Label: a.Name, Hint: "Runtime logs", Icon: "terminal", Href: base + "/logs?deployment=runtime"},
				pages.Command{Label: a.Name, Hint: "Settings", Icon: "sliders-horizontal", Href: base + "/settings", Keywords: "environment variables domains"},
			)
			if (h.s.Repos != nil || row.RedeploySHA() != "") && !a.Config.Stopped && row.State.Key != "publishing" {
				deploys = append(deploys, pages.Command{Label: i18n.Tf(r.Context(), "Publish %s", a.Name), Hint: "Latest version", Icon: "rocket", Action: ui.Post("/ui" + base + "/deploy?latest=1"), Keywords: "deploy release"})
			}
		}
		groups = append(groups, pages.CommandGroup{Label: "Apps", Commands: apps})
		if len(deploys) > 0 {
			groups = append(groups, pages.CommandGroup{Label: "Publish", Commands: deploys})
		}
	}

	actions := []pages.Command{}
	if admin {
		actions = append(actions,
			pages.Command{Label: "New app", Icon: "plus", Href: "/apps/new", Keywords: "create"},
			pages.Command{Label: "Add server", Icon: "server", Href: "/servers", Keywords: "invite agent"},
			pages.Command{Label: "Invite user", Icon: "user-plus", Href: "/settings/users"},
		)
	}
	actions = append(actions,
		pages.Command{Label: "Light theme", Icon: "sun", Attrs: templ.Attributes{"data-theme-set": "light"}, Keywords: "appearance"},
		pages.Command{Label: "Dark theme", Icon: "moon", Attrs: templ.Attributes{"data-theme-set": "dark"}, Keywords: "appearance"},
		pages.Command{Label: "System theme", Icon: "monitor", Attrs: templ.Attributes{"data-theme-set": "system"}, Keywords: "appearance"},
		pages.Command{Label: "Sign out", Icon: "log-out", Attrs: templ.Attributes{"data-logout": true}, Keywords: "logout"},
	)
	groups = append(groups, pages.CommandGroup{Label: "Actions", Commands: translated(r, actions)})
	for i := range groups {
		groups[i].Label = i18n.T(r.Context(), groups[i].Label)
		for j := range groups[i].Commands {
			groups[i].Commands[j].Hint = i18n.T(r.Context(), groups[i].Commands[j].Hint)
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	render(w, r, http.StatusOK, pages.CommandList(groups))
}

// translated renders fixed command labels in the viewer's language and keeps
// the English label searchable.
func translated(r *http.Request, cmds []pages.Command) []pages.Command {
	for i, c := range cmds {
		if t := i18n.T(r.Context(), c.Label); t != c.Label {
			cmds[i].Label, cmds[i].Keywords = t, c.Keywords+" "+c.Label
		}
	}
	return cmds
}
