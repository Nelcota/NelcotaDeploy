package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/bradleyfalzon/ghinstallation/v2"
	"github.com/google/go-github/v75/github"
	"github.com/nelcota/nelcota-deploy/internal/security"
)

type GitHubService struct {
	Core      *Core
	Transport http.RoundTripper
}

func (g *GitHubService) installation(ctx context.Context, id int64) (*ghinstallation.Transport, error) {
	app, e := g.Core.Setting(ctx, "github.app_id")
	if e != nil {
		return nil, e
	}
	key, e := g.Core.Setting(ctx, "github.private_key")
	if e != nil {
		return nil, e
	}
	appID, e := strconv.ParseInt(app, 10, 64)
	if e != nil {
		return nil, e
	}
	tr := g.Transport
	if tr == nil {
		tr = http.DefaultTransport
	}
	return ghinstallation.New(tr, appID, id, []byte(key))
}
func (g *GitHubService) Token(ctx context.Context, id int64) (string, error) {
	tr, e := g.installation(ctx, id)
	if e != nil {
		return "", e
	}
	return tr.Token(ctx)
}
func (g *GitHubService) Check(ctx context.Context, repo, sha, status string, checkID int64) (int64, error) {
	rows, e := g.Core.DB.Queries.ListApps(ctx)
	if e != nil {
		return 0, e
	}
	var installation int64
	for _, row := range rows {
		if row.Repository == repo {
			installation = decodeApp(row).Config.InstallationID
			break
		}
	}
	if installation == 0 {
		return 0, nil
	}
	tr, e := g.installation(ctx, installation)
	if e != nil {
		return 0, e
	}
	client := github.NewClient(&http.Client{Transport: tr, Timeout: 20 * time.Second})
	u, e := url.Parse(repo)
	if e != nil {
		return 0, e
	}
	parts := strings.Split(strings.Trim(strings.TrimSuffix(u.Path, ".git"), "/"), "/")
	if len(parts) != 2 {
		return 0, errors.New("invalid repository")
	}
	state := "in_progress"
	conclusion := ""
	switch status {
	case "success":
		state = "completed"
		conclusion = "success"
	case "failed":
		state = "completed"
		conclusion = "failure"
	case "cancelled":
		state = "completed"
		conclusion = "cancelled"
	}
	opts := github.CreateCheckRunOptions{Name: "Nelcota Deploy", HeadSHA: sha, Status: &state}
	if conclusion != "" {
		opts.Conclusion = &conclusion
		opts.CompletedAt = &github.Timestamp{Time: time.Now()}
	}
	if checkID == 0 {
		run, _, e := client.Checks.CreateCheckRun(ctx, parts[0], parts[1], opts)
		if e != nil {
			return 0, e
		}
		return run.GetID(), nil
	}
	update := github.UpdateCheckRunOptions{Name: opts.Name, Status: opts.Status, Conclusion: opts.Conclusion, CompletedAt: opts.CompletedAt}
	run, _, e := client.Checks.UpdateCheckRun(ctx, parts[0], parts[1], checkID, update)
	if e != nil {
		return 0, e
	}
	return run.GetID(), nil
}

type WebhookInput struct {
	Signature, Delivery, Event string
	Body                       []byte
}

func (g *GitHubService) Webhook(ctx context.Context, in WebhookInput) error {
	if len(in.Body) > 1<<20 || len(in.Delivery) == 0 || len(in.Delivery) > 200 {
		return fail(Validation, "Webhook inválido")
	}
	secret, e := g.Core.Setting(ctx, "github.webhook_secret")
	if e != nil || secret == "" {
		return fail(Unavailable, "Webhook não configurado")
	}
	signature, err := hex.DecodeString(strings.TrimPrefix(in.Signature, "sha256="))
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(in.Body)
	if err != nil || !strings.HasPrefix(in.Signature, "sha256=") || !hmac.Equal(signature, mac.Sum(nil)) {
		return fail(Unauthenticated, "Assinatura inválida")
	}
	if in.Event != "push" {
		return nil
	}
	var push struct {
		Ref        string `json:"ref"`
		After      string `json:"after"`
		Deleted    bool   `json:"deleted"`
		Repository struct {
			HTMLURL string `json:"html_url"`
		} `json:"repository"`
		Head struct {
			Message string `json:"message"`
			Author  struct {
				Name string `json:"name"`
			} `json:"author"`
		} `json:"head_commit"`
	}
	if e = json.Unmarshal(in.Body, &push); e != nil {
		return fail(Validation, "Payload inválido")
	}
	if push.Deleted {
		return nil
	}
	if !shaPattern.MatchString(push.After) {
		return fail(Validation, "SHA inválido")
	}
	apps, e := g.Core.DB.Queries.ListApps(ctx)
	if e != nil {
		return e
	}
	return g.Core.mutate(systemContext(ctx), func(tx *sql.Tx) error {
		r, e := tx.ExecContext(ctx, "INSERT INTO webhook_deliveries(id,received_at) VALUES(?,?) ON CONFLICT DO NOTHING", in.Delivery, time.Now().Unix())
		if e != nil {
			return e
		}
		n, _ := r.RowsAffected()
		if n == 0 {
			return nil
		}
		for _, a := range apps {
			if strings.TrimSuffix(a.Repository, ".git") != push.Repository.HTMLURL || push.Ref != "refs/heads/"+a.Branch {
				continue
			}
			input := DeployInput{AppID: a.ID, SHA: push.After, Message: truncate(push.Head.Message, 1000), Author: truncate(push.Head.Author.Name, 200), Origin: "push"}
			if e := (&deploysService{g.Core}).enqueue(systemContext(ctx), tx, security.Token(), input); e != nil {
				return e
			}
		}
		return nil
	})
}
func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

type GitHubManifest struct {
	Action    string          `json:"action"`
	Manifest  json.RawMessage `json:"manifest"`
	ExpiresAt time.Time       `json:"expires_at"`
}

func (g *GitHubService) BeginManifest(ctx context.Context, origin string) (GitHubManifest, error) {
	p, e := authorize(ctx, "settings:write", true)
	if e != nil {
		return GitHubManifest{}, e
	}
	state := security.Token()
	expires := time.Now().Add(10 * time.Minute)
	_, e = g.Core.DB.Write.ExecContext(ctx, "INSERT INTO challenges(token_hash,user_id,purpose,data,expires_at) VALUES(?,?,'github_manifest','{}',?)", security.Hash(state), p.ID, expires.Unix())
	if e != nil {
		return GitHubManifest{}, e
	}
	manifest := map[string]any{"name": "Nelcota Deploy", "url": origin, "hook_attributes": map[string]any{"url": origin + "/api/webhooks/github", "active": true}, "redirect_url": origin + "/api/github/callback", "public": false, "default_permissions": map[string]string{"contents": "read", "metadata": "read", "checks": "write"}, "default_events": []string{"push"}}
	b, e := json.Marshal(manifest)
	return GitHubManifest{Action: "https://github.com/settings/apps/new?state=" + url.QueryEscape(state), Manifest: b, ExpiresAt: expires}, e
}
func (g *GitHubService) FinishManifest(ctx context.Context, state, code string) (map[string]string, error) {
	if len(code) < 1 || len(code) > 200 || strings.ContainsAny(code, "/?#\r\n") {
		return nil, fail(Validation, "Código inválido")
	}
	var user string
	e := g.Core.DB.Write.QueryRowContext(ctx, "DELETE FROM challenges WHERE token_hash=? AND purpose='github_manifest' AND expires_at>? RETURNING user_id", security.Hash(state), time.Now().Unix()).Scan(&user)
	if e != nil {
		return nil, fail(Unauthenticated, "Estado inválido")
	}
	u, e := g.Core.DB.Queries.GetUser(ctx, user)
	if e != nil || u.Role != "admin" {
		return nil, fail(Forbidden, "Administrador necessário")
	}
	client := github.NewClient(&http.Client{Timeout: 20 * time.Second})
	app, _, e := client.Apps.CompleteAppManifest(ctx, code)
	if e != nil {
		return nil, fail(Unavailable, "GitHub recusou a configuração")
	}
	ctx = WithPrincipal(ctx, Principal{ID: u.ID, Role: u.Role})
	values := map[string]string{"github.app_id": strconv.FormatInt(app.GetID(), 10), "github.private_key": app.GetPEM(), "github.webhook_secret": app.GetWebhookSecret(), "github.client_id": app.GetClientID(), "github.client_secret": app.GetClientSecret()}
	e = g.Core.mutate(ctx, func(tx *sql.Tx) error {
		for k, v := range values {
			b, e := g.Core.Vault.Seal([]byte(v), "setting:"+k)
			if e != nil {
				return e
			}
			if _, e = tx.ExecContext(ctx, "INSERT INTO settings(key,encrypted) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET encrypted=excluded.encrypted", k, b); e != nil {
				return e
			}
		}
		return g.Core.audit(ctx, tx, "github.configure", strconv.FormatInt(app.GetID(), 10))
	})
	return map[string]string{"installation_url": "https://github.com/apps/" + app.GetSlug() + "/installations/new"}, e
}
