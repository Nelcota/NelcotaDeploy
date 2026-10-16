package web

import (
	"bufio"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/Nelcota/NelcotaDeploy/web/i18n"
	"github.com/Nelcota/NelcotaDeploy/web/pages"
	"github.com/go-chi/chi/v5"
)

func invalid(message string) error { return &service.Error{Kind: service.Validation, Message: message} }

// appInput converts the app form into the service DTO. Fields the form does not
// edit (such as the stopped flag) are kept from base. Services validate ranges.
func appInput(form url.Values, base service.AppConfig) (service.AppInput, error) {
	in := service.AppInput{
		Name:       strings.TrimSpace(form.Get("name")),
		ServerID:   form.Get("server_id"),
		Repository: strings.TrimSuffix(strings.TrimSpace(form.Get("repository")), "/"),
		Branch:     strings.TrimSpace(form.Get("branch")),
		Config:     base,
	}
	cfg := &in.Config
	cfg.Dockerfile = strings.TrimSpace(form.Get("dockerfile"))
	cfg.HealthPath = strings.TrimSpace(form.Get("health_path"))
	cfg.CacheEnabled = form.Get("cache_enabled") == "true"
	cfg.Domains = []string{}
	for _, d := range strings.FieldsFunc(form.Get("domains"), func(r rune) bool { return r == '\n' || r == '\r' || r == ',' || r == ' ' }) {
		cfg.Domains = append(cfg.Domains, strings.ToLower(strings.TrimSuffix(d, ".")))
	}
	number := func(name, label string, bits int) (uint64, error) {
		v, err := strconv.ParseUint(strings.TrimSpace(form.Get(name)), 10, bits)
		if err != nil {
			return 0, invalid(label + " must be a whole number")
		}
		return v, nil
	}
	port, err := number("port", "Port", 32)
	if err != nil {
		return in, err
	}
	timeout, err := number("health_timeout", "Health check timeout", 32)
	if err != nil {
		return in, err
	}
	replicas, err := number("replicas", "Copies", 32)
	if err != nil {
		return in, err
	}
	memory, err := number("memory_mib", "Memory", 32)
	if err != nil {
		return in, err
	}
	installation, err := strconv.ParseInt(strings.TrimSpace(form.Get("installation_id")), 10, 64)
	if err != nil || installation < 0 {
		return in, invalid("Installation ID must be a whole number")
	}
	cpus, err := strconv.ParseFloat(strings.TrimSpace(form.Get("cpus")), 64)
	if err != nil || math.IsNaN(cpus) || cpus <= 0 || cpus > 64 {
		return in, invalid("CPU must be between 0.01 and 64 cores")
	}
	cfg.Port, cfg.HealthTimeout, cfg.Replicas = uint32(port), uint32(timeout), uint32(replicas)
	cfg.MemoryBytes = int64(memory) << 20
	cfg.NanoCPUs = int64(math.Round(cpus * 1e9))
	cfg.InstallationID = installation
	return in, nil
}

func (h *handler) newAppPage(w http.ResponseWriter, r *http.Request) {
	if mustUser(r).Role != "admin" {
		h.failPage(w, r, "apps", &service.Error{Kind: service.Forbidden, Message: "Administrator permission required"})
		return
	}
	servers, err := h.s.Servers.List(r.Context())
	if err != nil {
		h.failPage(w, r, "apps", err)
		return
	}
	render(w, r, http.StatusOK, pages.NewApp(h.shell(r, "New app", "apps"), pages.WizardView{Servers: servers}))
}

func wizardInput(r *http.Request) (pages.WizardView, error) {
	if err := r.ParseForm(); err != nil {
		return pages.WizardView{}, invalid("Invalid form")
	}
	v := pages.WizardView{Repository: strings.TrimSuffix(strings.TrimSpace(r.PostForm.Get("repository")), "/")}
	if raw := strings.TrimSpace(r.PostForm.Get("installation_id")); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < 0 {
			return v, invalid("Installation ID must be a whole number")
		}
		v.InstallationID = n
	}
	return v, nil
}

// githubRepository is a quick shape check for the wizard; the service validates fully.
func githubRepository(s string) bool {
	u, err := url.Parse(s)
	return err == nil && u.Scheme == "https" && u.Host == "github.com" && len(strings.Split(strings.Trim(u.Path, "/"), "/")) == 2
}

// inspectNewApp reads the repository and shows the prefilled settings step.
func (h *handler) inspectNewApp(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		v, err := wizardInput(r)
		if err != nil {
			return err
		}
		if v.Servers, err = h.s.Servers.List(r.Context()); err != nil {
			return err
		}
		parts := strings.Split(strings.TrimPrefix(v.Repository, "https://github.com/"), "/")
		v.Name = strings.ToLower(strings.TrimSuffix(parts[len(parts)-1], ".git"))
		if !githubRepository(v.Repository) {
			return s.patch(pages.WizardRepository(v, "Use a GitHub address like https://github.com/you/your-app."), "", "")
		}
		if h.s.Repos != nil {
			info, err := h.s.Repos.Inspect(r.Context(), service.RepoQuery{Repository: v.Repository, InstallationID: v.InstallationID})
			if err != nil {
				return s.patch(pages.WizardRepository(v, publicMessage(err)), "", "")
			}
			v.Info, v.Inspected = info, true
		}
		return s.patch(pages.WizardSettings(v), "", "")
	})
}

func (h *handler) wizardBack(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		v, err := wizardInput(r)
		if err != nil {
			return err
		}
		return s.patch(pages.WizardRepository(v, ""), "", "")
	})
}

// createApp creates the app and, when the wizard knows the branch head,
// publishes it right away.
func (h *handler) createApp(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := r.ParseForm(); err != nil {
			return invalid("Invalid form")
		}
		in, err := appInput(r.PostForm, service.AppConfig{})
		if err != nil {
			return err
		}
		vars, err := wizardEnvironment(r.PostForm)
		if err != nil {
			return err
		}
		app, err := h.s.Apps.Create(r.Context(), in)
		if err != nil {
			return err
		}
		if len(vars) > 0 {
			if err := h.s.Apps.SetEnvironment(r.Context(), app.ID, vars); err != nil {
				return err
			}
		}
		if sha := r.PostForm.Get("publish_sha"); sha != "" {
			message := r.PostForm.Get("publish_message")
			if message == "" {
				message = "First deployment"
			}
			if _, err := h.s.Deploys.Enqueue(r.Context(), service.DeployInput{AppID: app.ID, SHA: sha, Message: message, Author: mustUser(r).Name, Origin: "manual"}); err != nil {
				return err
			}
		}
		return s.redirect("/apps/" + app.ID)
	})
}

// wizardEnvironment pairs the wizard's variable names with the values filled in.
func wizardEnvironment(form url.Values) ([]service.EnvInput, error) {
	keys, values := form["env_key"], form["env_value"]
	if len(keys) != len(values) {
		return nil, invalid("Invalid form")
	}
	var vars []service.EnvInput
	for i, k := range keys {
		if values[i] != "" {
			vars = append(vars, service.EnvInput{Key: k, Value: values[i]})
		}
	}
	return vars, nil
}

func (h *handler) appSettings(r *http.Request, c pages.AppContext) pages.AppSettingsView {
	v := pages.AppSettingsView{Form: pages.AppFormView{ID: c.App.ID, Input: service.AppInput{Name: c.App.Name, ServerID: c.App.ServerID, Repository: c.App.Repository, Branch: c.App.Branch, Config: c.App.Config}}}
	if mustUser(r).Role != "admin" {
		return v
	}
	v.Form.Servers, _ = h.s.Servers.List(r.Context())
	env, err := h.s.Apps.Environment(r.Context(), c.App.ID)
	if err != nil {
		v.EnvErr = publicMessage(err)
	}
	v.Env = env
	return v
}

func (h *handler) appSettingsPage(w http.ResponseWriter, r *http.Request) {
	c, err := h.appContext(r, "settings")
	if err != nil {
		h.failPage(w, r, "apps", err)
		return
	}
	render(w, r, http.StatusOK, pages.AppSettings(h.shell(r, i18n.Tf(r.Context(), "%s settings", c.App.Name), "apps"), c, h.appSettings(r, c)))
}

func (h *handler) saveAppSettings(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := r.ParseForm(); err != nil {
			return invalid("Invalid form")
		}
		current, err := h.s.Apps.Get(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		in, err := appInput(r.PostForm, current.Config)
		if err != nil {
			return err
		}
		in.ServerID = current.ServerID
		if _, err := h.s.Apps.Update(r.Context(), current.ID, in); err != nil {
			return err
		}
		if err := s.signals(map[string]any{"_dirty": false}); err != nil {
			return err
		}
		return s.toast("success", "Settings saved.")
	})
}

// refreshEnv re-renders the environment card and clears its forms after a change.
func (h *handler) refreshEnv(s *stream, r *http.Request, id, message string) error {
	app, err := h.s.Apps.Get(r.Context(), id)
	if err != nil {
		return err
	}
	env, err := h.s.Apps.Environment(r.Context(), id)
	if err != nil {
		return err
	}
	if err := s.patch(pages.EnvCard(app, env, ""), "", ""); err != nil {
		return err
	}
	if err := s.closeAndReset("#env"); err != nil {
		return err
	}
	return s.toast("success", message)
}

func (h *handler) setEnv(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := r.ParseForm(); err != nil {
			return invalid("Invalid form")
		}
		key := strings.TrimSpace(r.PostForm.Get("key"))
		id := chi.URLParam(r, "id")
		if err := h.s.Apps.SetEnvironment(r.Context(), id, []service.EnvInput{{Key: key, Value: r.PostForm.Get("value"), Build: r.PostForm.Get("build") == "true"}}); err != nil {
			return err
		}
		return h.refreshEnv(s, r, id, i18n.Tf(r.Context(), "%s saved.", key))
	})
}

// parseDotenv reads KEY=value lines. Blank lines and # comments are ignored, an
// optional "export " prefix is accepted, and matching outer quotes are removed.
func parseDotenv(text string, build bool) ([]service.EnvInput, error) {
	var out []service.EnvInput
	sc := bufio.NewScanner(strings.NewReader(text))
	sc.Buffer(make([]byte, 0, 64<<10), 1<<20)
	for n := 1; sc.Scan(); n++ {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(strings.TrimPrefix(line, "export "), "=")
		if !ok {
			return nil, invalid(fmt.Sprintf("Line %d is not KEY=value", n))
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			value = value[1 : len(value)-1]
		}
		out = append(out, service.EnvInput{Key: strings.TrimSpace(key), Value: value, Build: build})
	}
	if err := sc.Err(); err != nil {
		return nil, invalid("Could not read the variables")
	}
	if len(out) == 0 {
		return nil, invalid("No variables found")
	}
	return out, nil
}

// envPlan turns the pasted list into the patch to apply and the review lines.
func (h *handler) envPlan(r *http.Request, id string) ([]service.EnvInput, []pages.EnvChange, error) {
	if err := r.ParseForm(); err != nil {
		return nil, nil, invalid("Invalid form")
	}
	vars, err := parseDotenv(r.PostForm.Get("dotenv"), r.PostForm.Get("build") == "true")
	if err != nil {
		return nil, nil, err
	}
	current, err := h.s.Apps.Environment(r.Context(), id)
	if err != nil {
		return nil, nil, err
	}
	existing := map[string]bool{}
	for _, v := range current {
		existing[v.Key] = true
	}
	listed := map[string]bool{}
	var changes []pages.EnvChange
	for _, v := range vars {
		listed[v.Key] = true
		kind := "add"
		if existing[v.Key] {
			kind = "replace"
		}
		changes = append(changes, pages.EnvChange{Key: v.Key, Kind: kind})
	}
	if r.PostForm.Get("prune") == "true" {
		for _, v := range current {
			if !listed[v.Key] {
				vars = append(vars, service.EnvInput{Key: v.Key, Delete: true})
				changes = append(changes, pages.EnvChange{Key: v.Key, Kind: "remove"})
			}
		}
	}
	return vars, changes, nil
}

func (h *handler) previewEnv(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		id := chi.URLParam(r, "id")
		_, changes, err := h.envPlan(r, id)
		if err != nil {
			return err
		}
		return s.patch(pages.EnvReview(id, changes), "", "")
	})
}

func (h *handler) importEnv(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := r.ParseForm(); err != nil {
			return invalid("Invalid form")
		}
		id := chi.URLParam(r, "id")
		vars, _, err := h.envPlan(r, id)
		if err != nil {
			return err
		}
		if err := h.s.Apps.SetEnvironment(r.Context(), id, vars); err != nil {
			return err
		}
		return h.refreshEnv(s, r, id, i18n.Tf(r.Context(), "%d change(s) saved.", len(vars)))
	})
}

func (h *handler) deleteEnv(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		id, key := chi.URLParam(r, "id"), chi.URLParam(r, "key")
		if err := h.s.Apps.SetEnvironment(r.Context(), id, []service.EnvInput{{Key: key, Delete: true}}); err != nil {
			return err
		}
		return h.refreshEnv(s, r, id, i18n.Tf(r.Context(), "%s deleted.", key))
	})
}

func (h *handler) appAction(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		id, action := chi.URLParam(r, "id"), chi.URLParam(r, "action")
		// Stop asks for confirmation in the dialog; the service requires the flag.
		if err := h.s.Apps.Action(r.Context(), id, action, 0, action == "stop"); err != nil {
			return err
		}
		app, err := h.s.Apps.Get(r.Context(), id)
		if err != nil {
			return err
		}
		if err := s.patch(pages.RuntimeCard(app), "", ""); err != nil {
			return err
		}
		messages := map[string]string{"start": "starting.", "stop": "stopped.", "restart": "restarting."}
		return s.toast("success", app.Name+" "+messages[action])
	})
}

func (h *handler) deleteApp(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if err := r.ParseForm(); err != nil {
			return invalid("Invalid form")
		}
		id := chi.URLParam(r, "id")
		app, err := h.s.Apps.Get(r.Context(), id)
		if err != nil {
			return err
		}
		if r.PostForm.Get("confirm_name") != app.Name {
			return invalid("Type the app name exactly to confirm.")
		}
		if err := h.s.Apps.Delete(r.Context(), id, true); err != nil {
			return err
		}
		return s.redirect("/apps")
	})
}
