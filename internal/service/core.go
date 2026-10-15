package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/nelcota/nelcota-deploy/internal/events"
	agentv1 "github.com/nelcota/nelcota-deploy/internal/gen/agent/v1"
	"github.com/nelcota/nelcota-deploy/internal/maintenance"
	"github.com/nelcota/nelcota-deploy/internal/security"
	"github.com/nelcota/nelcota-deploy/internal/store"
	"github.com/nelcota/nelcota-deploy/internal/store/dbgen"
)

type Dispatcher interface {
	Send(context.Context, string, *agentv1.Command) error
}
type GitHub interface {
	Token(context.Context, int64) (string, error)
	Check(context.Context, string, string, string, int64) (int64, error)
}
type Core struct {
	logMu           sync.Mutex
	runtimeWatchers map[string]int
	DB              *store.Store
	Vault           *security.Vault
	Hub             *events.Hub
	LogStore        *events.LogStore
	Control         Dispatcher
	GitHub          GitHub
	Operations      *OperationsService
}

func (c *Core) Services(auth *AuthService) Services {
	ops := c.Operations
	if ops == nil {
		ops = &OperationsService{Core: c}
	}
	return Services{Apps: &appsService{c}, Deploys: &deploysService{c}, Servers: &serversService{c}, Logs: &logsService{c}, Auth: auth, Users: auth, Settings: &settingsService{c}, Audit: &auditService{c}, Operations: ops}
}
func decodeApp(v dbgen.App) App {
	a := App{ID: v.ID, Name: v.Name, ServerID: v.ServerID, Repository: v.Repository, Branch: v.Branch, DesiredSHA: v.DesiredSha, Revision: v.Revision}
	_ = json.Unmarshal([]byte(v.Config), &a.Config)
	return a
}
func decodeDeploy(v dbgen.Deployment) Deployment {
	d := Deployment{ID: v.ID, AppID: v.AppID, SHA: v.Sha, Message: v.Message, Author: v.Author, Origin: v.Origin, Status: v.Status, QueuedAt: v.QueuedAt, StartedAt: v.StartedAt, FinishedAt: v.FinishedAt, ErrorCode: v.ErrorCode, Clean: v.Clean != 0, Timings: map[string]int64{}, CancelRequested: v.CancelRequested != 0}
	_ = json.Unmarshal([]byte(v.Timings), &d.Timings)
	return d
}

func dbError(e error) error {
	if errors.Is(e, sql.ErrNoRows) {
		return fail(NotFound, "Recurso não encontrado")
	}
	if e != nil {
		return fail(Conflict, "Operação não pôde ser concluída")
	}
	return nil
}
func (c *Core) audit(ctx context.Context, tx *sql.Tx, action, target string) error {
	p, e := CurrentUser(ctx)
	if e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO audit_log(user_id,action,target,ip,created_at) VALUES(?,?,?,?,?)", p.ID, action, target, p.IP, time.Now().Unix())
	return e
}
func (c *Core) mutate(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, e := c.DB.Write.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if e = fn(tx); e != nil {
		return e
	}
	return tx.Commit()
}
func (c *Core) publish(topic, kind string, v any) {
	b, e := json.Marshal(v)
	if e == nil {
		c.Hub.Publish(topic, kind, b)
	}
}

var shaPattern = regexp.MustCompile(`^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$`)
var envPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,127}$`)
var hostPattern = regexp.MustCompile(`^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)

func validateApp(in *AppInput) error {
	if len(in.Name) < 1 || len(in.Name) > 80 || len(in.Branch) < 1 || len(in.Branch) > 200 || strings.HasPrefix(in.Branch, "-") || strings.ContainsAny(in.Branch, "\r\n\x00") {
		return fail(Validation, "Nome ou branch inválidos")
	}
	u, e := url.Parse(in.Repository)
	if e != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(strings.Split(strings.Trim(u.Path, "/"), "/")) != 2 {
		return fail(Validation, "Repositório deve ser uma URL HTTPS do GitHub")
	}
	cfg := &in.Config
	if cfg.Port == 0 {
		cfg.Port = 8080
	}
	if cfg.Port > 65535 {
		return fail(Validation, "Porta inválida")
	}
	if cfg.MemoryBytes == 0 {
		cfg.MemoryBytes = 256 << 20
	}
	if cfg.NanoCPUs == 0 {
		cfg.NanoCPUs = 1e9
	}
	if cfg.MemoryBytes < 32<<20 || cfg.MemoryBytes > 64<<30 || cfg.NanoCPUs < 1e7 || cfg.NanoCPUs > 64e9 {
		return fail(Validation, "Limites de recursos inválidos")
	}
	if cfg.Replicas == 0 {
		cfg.Replicas = 1
	}
	if cfg.Replicas > 16 {
		return fail(Validation, "Máximo de 16 réplicas")
	}
	if cfg.HealthPath == "" {
		cfg.HealthPath = "/"
	}
	if !strings.HasPrefix(cfg.HealthPath, "/") || strings.HasPrefix(cfg.HealthPath, "//") || strings.ContainsAny(cfg.HealthPath, "\r\n") {
		return fail(Validation, "Healthcheck inválido")
	}
	if cfg.HealthTimeout == 0 {
		cfg.HealthTimeout = 60
	}
	if cfg.HealthTimeout > 600 {
		return fail(Validation, "Timeout máximo de 600 segundos")
	}
	if cfg.Dockerfile == "" {
		cfg.Dockerfile = "Dockerfile"
	}
	if strings.Contains(cfg.Dockerfile, "..") || strings.HasPrefix(cfg.Dockerfile, "/") || strings.ContainsAny(cfg.Dockerfile, "\x00\r\n") {
		return fail(Validation, "Dockerfile inválido")
	}
	if len(cfg.Domains) > 20 {
		return fail(Validation, "Muitos domínios")
	}
	for _, d := range cfg.Domains {
		if !hostPattern.MatchString(d) {
			return fail(Validation, "Domínio inválido")
		}
	}
	return nil
}

type appsService struct{ c *Core }

func (s *appsService) List(ctx context.Context) ([]App, error) {
	if _, e := authorize(ctx, "apps:read", false); e != nil {
		return nil, e
	}
	rows, e := s.c.DB.Queries.ListApps(ctx)
	if e != nil {
		return nil, dbError(e)
	}
	out := make([]App, 0, len(rows))
	for _, r := range rows {
		out = append(out, decodeApp(r))
	}
	return out, nil
}
func (s *appsService) Get(ctx context.Context, id string) (App, error) {
	if _, e := authorize(ctx, "apps:read", false); e != nil {
		return App{}, e
	}
	r, e := s.c.DB.Queries.GetApp(ctx, id)
	return decodeApp(r), dbError(e)
}
func (s *appsService) Create(ctx context.Context, in AppInput) (App, error) {
	return s.save(ctx, "", in)
}
func (s *appsService) Update(ctx context.Context, id string, in AppInput) (App, error) {
	return s.save(ctx, id, in)
}
func (s *appsService) save(ctx context.Context, id string, in AppInput) (App, error) {
	if _, e := authorize(ctx, "apps:write", true); e != nil {
		return App{}, e
	}
	if e := validateApp(&in); e != nil {
		return App{}, e
	}
	create := id == ""
	if create {
		id = security.Token()
	}
	cfg, _ := json.Marshal(in.Config)
	e := s.c.mutate(ctx, func(tx *sql.Tx) error {
		if create {
			_, e := tx.ExecContext(ctx, "INSERT INTO apps(id,name,server_id,repository,branch,config) VALUES(?,?,?,?,?,?)", id, in.Name, in.ServerID, in.Repository, in.Branch, string(cfg))
			if e != nil {
				return dbError(e)
			}
		} else {
			r, e := tx.ExecContext(ctx, "UPDATE apps SET name=?,server_id=?,repository=?,branch=?,config=?,revision=revision+1 WHERE id=? AND server_id=?", in.Name, in.ServerID, in.Repository, in.Branch, string(cfg), id, in.ServerID)
			if e != nil {
				return dbError(e)
			}
			n, _ := r.RowsAffected()
			if n == 0 {
				return fail(NotFound, "App inexistente ou migração de server não permitida")
			}
		}
		if _, e := tx.ExecContext(ctx, "DELETE FROM domains WHERE app_id=?", id); e != nil {
			return e
		}
		for _, host := range in.Config.Domains {
			if _, e := tx.ExecContext(ctx, "INSERT INTO domains(id,app_id,host) VALUES(?,?,?)", security.Token(), id, host); e != nil {
				return dbError(e)
			}
		}
		return s.c.audit(ctx, tx, "app.save", id)
	})
	if e != nil {
		return App{}, e
	}
	a, e := s.Get(ctx, id)
	s.c.publish("apps", "app.updated", a)
	return a, e
}
func (s *appsService) Delete(ctx context.Context, id string, confirmed bool) error {
	if _, e := authorize(ctx, "apps:write", true); e != nil {
		return e
	}
	if !confirmed {
		return fail(Validation, "Confirmação obrigatória")
	}
	a, e := s.Get(ctx, id)
	if e != nil {
		return e
	}
	if !a.Config.Stopped {
		return fail(Conflict, "Pare a app antes de excluir")
	}
	return s.c.mutate(ctx, func(tx *sql.Tx) error {
		var n int
		if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM deployments WHERE app_id=? AND status IN ('queued','building','starting')", id).Scan(&n); e != nil {
			return e
		}
		if n > 0 {
			return fail(Conflict, "App possui deploys pendentes")
		}
		if _, e := tx.ExecContext(ctx, "DELETE FROM deployments WHERE app_id=?", id); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, "DELETE FROM apps WHERE id=?", id); e != nil {
			return e
		}
		return s.c.audit(ctx, tx, "app.delete", id)
	})
}
func (s *appsService) Environment(ctx context.Context, id string) ([]EnvInfo, error) {
	if _, e := authorize(ctx, "apps:write", true); e != nil {
		return nil, e
	}
	if _, e := s.Get(ctx, id); e != nil {
		return nil, e
	}
	rows, e := s.c.DB.Queries.GetEnvironment(ctx, id)
	out := make([]EnvInfo, 0, len(rows))
	for _, r := range rows {
		out = append(out, EnvInfo{r.Key, r.Build != 0, true})
	}
	return out, dbError(e)
}
func (s *appsService) SetEnvironment(ctx context.Context, id string, vars []EnvInput) error {
	if _, e := authorize(ctx, "apps:write", true); e != nil {
		return e
	}
	if _, e := s.Get(ctx, id); e != nil {
		return e
	}
	if len(vars) > 200 {
		return fail(Validation, "Muitas variáveis")
	}
	seen := map[string]bool{}
	encrypted := make([][]byte, len(vars))
	for i, v := range vars {
		if !envPattern.MatchString(v.Key) || seen[v.Key] || len(v.Value) > 65536 || strings.ContainsRune(v.Value, 0) {
			return fail(Validation, "Variável inválida ou duplicada")
		}
		seen[v.Key] = true
		var e error
		encrypted[i], e = s.c.Vault.Seal([]byte(v.Value), id+":"+v.Key)
		if e != nil {
			return e
		}
	}
	return s.c.mutate(ctx, func(tx *sql.Tx) error {
		for i, v := range vars {
			if v.Delete {
				if _, e := tx.ExecContext(ctx, "DELETE FROM env_vars WHERE app_id=? AND key=?", id, v.Key); e != nil {
					return e
				}
				continue
			}
			if _, e := tx.ExecContext(ctx, "INSERT INTO env_vars(app_id,key,encrypted,build) VALUES(?,?,?,?) ON CONFLICT(app_id,key) DO UPDATE SET encrypted=excluded.encrypted,build=excluded.build", id, v.Key, encrypted[i], v.Build); e != nil {
				return e
			}
		}
		if _, e := tx.ExecContext(ctx, "UPDATE apps SET revision=revision+1 WHERE id=?", id); e != nil {
			return e
		}
		var total, count int64
		if e := tx.QueryRowContext(ctx, "SELECT COALESCE(sum(length(encrypted)),0),count(*) FROM env_vars WHERE app_id=?", id).Scan(&total, &count); e != nil {
			return e
		}
		if total > 512<<10 || count > 200 {
			return fail(Validation, "Limite de variáveis excedido")
		}
		return s.c.audit(ctx, tx, "env.patch", id)
	})
}
func (s *appsService) Action(ctx context.Context, id, action string, replicas uint32, confirmed bool) error {
	if _, e := authorize(ctx, "apps:write", true); e != nil {
		return e
	}
	a, e := s.Get(ctx, id)
	if e != nil {
		return e
	}
	if action == "stop" && !confirmed {
		return fail(Validation, "Confirmação obrigatória")
	}
	switch action {
	case "start":
		a.Config.Stopped = false
	case "stop":
		a.Config.Stopped = true
	case "scale":
		if replicas < 1 || replicas > 16 {
			return fail(Validation, "Réplicas inválidas")
		}
		a.Config.Replicas = replicas
	case "restart":
	default:
		return fail(Validation, "Ação inválida")
	}
	_, e = s.Update(ctx, id, AppInput{a.Name, a.ServerID, a.Repository, a.Branch, a.Config})
	if e != nil {
		return e
	}
	if action == "restart" {
		if s.c.Control == nil {
			return fail(Unavailable, "Agent indisponível")
		}
		return s.c.send(ctx, a.ServerID, &agentv1.Command{Action: &agentv1.Command_Restart{Restart: &agentv1.AppAction{AppId: id}}})
	}
	return nil
}

type serversService struct{ c *Core }

func (s *serversService) List(ctx context.Context) ([]Server, error) {
	if _, e := authorize(ctx, "servers:read", false); e != nil {
		return nil, e
	}
	rows, e := s.c.DB.Queries.ListServers(ctx)
	out := make([]Server, 0, len(rows))
	for _, r := range rows {
		out = append(out, Server{ID: r.ID, Name: r.Name, WireGuardIP: r.WireguardIp, Status: r.Status, HeartbeatAt: r.HeartbeatAt, BuildLimit: r.BuildLimit, CacheBytes: r.CacheBytes, Version: r.AgentVersion, Ready: r.AgentReady != 0})
	}
	return out, dbError(e)
}
func (s *serversService) Invite(ctx context.Context, in ServerInput) (Invitation, error) {
	if _, e := authorize(ctx, "servers:write", true); e != nil {
		return Invitation{}, e
	}
	ip := net.ParseIP(in.WireGuardIP)
	if ip == nil || !ip.IsPrivate() || ip.To4() == nil || len(in.Name) < 1 || len(in.Name) > 80 {
		return Invitation{}, fail(Validation, "Nome e IPv4 privado obrigatórios")
	}
	if in.BuildLimit == 0 {
		in.BuildLimit = 1
	}
	if in.BuildLimit < 1 || in.BuildLimit > 8 {
		return Invitation{}, fail(Validation, "Limite de builds inválido")
	}
	if in.CacheBytes == 0 {
		in.CacheBytes = 5 << 30
	}
	if in.CacheBytes < 0 || in.CacheBytes > 100<<30 {
		return Invitation{}, fail(Validation, "Teto de cache inválido")
	}
	token := security.Token()
	id := security.Token()
	expires := time.Now().Add(15 * time.Minute)
	e := s.c.mutate(ctx, func(tx *sql.Tx) error {
		if _, e := tx.ExecContext(ctx, "INSERT INTO servers(id,name,wireguard_ip,build_limit,cache_bytes) VALUES(?,?,?,?,?)", id, in.Name, in.WireGuardIP, in.BuildLimit, in.CacheBytes); e != nil {
			return dbError(e)
		}
		if _, e := tx.ExecContext(ctx, "INSERT INTO invitations(token_hash,server_id,expires_at) VALUES(?,?,?)", security.Hash(token), id, expires.Unix()); e != nil {
			return e
		}
		return s.c.audit(ctx, tx, "server.invite", id)
	})
	return Invitation{id, token, expires}, e
}
func (s *serversService) Prune(ctx context.Context, id, scope string, confirmed bool) error {
	if _, e := authorize(ctx, "servers:write", true); e != nil {
		return e
	}
	if !confirmed {
		return fail(Validation, "Confirmação obrigatória")
	}
	var v agentv1.Prune_Scope
	switch scope {
	case "cache":
		v = agentv1.Prune_CACHE
	case "orphan_images":
		v = agentv1.Prune_ORPHAN_IMAGES
	default:
		return fail(Validation, "Escopo inválido")
	}
	if s.c.Control == nil {
		return fail(Unavailable, "Agent indisponível")
	}
	if e := s.c.mutate(ctx, func(tx *sql.Tx) error { return s.c.audit(ctx, tx, "server.prune."+scope, id) }); e != nil {
		return e
	}
	return s.c.send(ctx, id, &agentv1.Command{Action: &agentv1.Command_Prune{Prune: &agentv1.Prune{Scope: v}}})
}

type settingsService struct{ c *Core }

func (s *settingsService) Get(ctx context.Context) (SettingsView, error) {
	if _, e := authorize(ctx, "settings:write", true); e != nil {
		return SettingsView{}, e
	}
	r, e := s.c.DB.Read.QueryContext(ctx, "SELECT key FROM settings ORDER BY key")
	if e != nil {
		return SettingsView{}, e
	}
	defer r.Close()
	out := SettingsView{Configured: []string{}}
	for r.Next() {
		var k string
		if e = r.Scan(&k); e != nil {
			return out, e
		}
		out.Configured = append(out.Configured, k)
	}
	return out, r.Err()
}
func (s *settingsService) Set(ctx context.Context, key, value string) error {
	if _, e := authorize(ctx, "settings:write", true); e != nil {
		return e
	}
	switch key {
	case "backup.s3":
		if value != "" {
			var cfg maintenance.S3
			if json.Unmarshal([]byte(value), &cfg) != nil || cfg.Validate() != nil {
				return fail(Validation, "Configuração S3 inválida")
			}
		}
	case "github.app_id", "github.private_key", "github.webhook_secret", "github.client_id", "github.client_secret":
	default:
		return fail(Validation, "Ajuste desconhecido")
	}
	if len(value) > 32768 {
		return fail(Validation, "Valor muito grande")
	}
	b, e := s.c.Vault.Seal([]byte(value), "setting:"+key)
	if e != nil {
		return e
	}
	return s.c.mutate(ctx, func(tx *sql.Tx) error {
		if _, e := tx.ExecContext(ctx, "INSERT INTO settings(key,encrypted) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET encrypted=excluded.encrypted", key, b); e != nil {
			return e
		}
		return s.c.audit(ctx, tx, "settings.update", key)
	})
}
func (c *Core) Setting(ctx context.Context, key string) (string, error) {
	var b []byte
	if e := c.DB.Read.QueryRowContext(ctx, "SELECT encrypted FROM settings WHERE key=?", key).Scan(&b); e != nil {
		return "", e
	}
	p, e := c.Vault.Open(b, "setting:"+key)
	return string(p), e
}

type auditService struct{ c *Core }

func (s *auditService) List(ctx context.Context, limit int) ([]AuditEntry, error) {
	if _, e := authorize(ctx, "audit:read", true); e != nil {
		return nil, e
	}
	if limit < 1 || limit > 1000 {
		limit = 100
	}
	rows, e := s.c.DB.Queries.ListAudit(ctx, int64(limit))
	out := make([]AuditEntry, 0, len(rows))
	for _, r := range rows {
		out = append(out, AuditEntry{r.ID, r.UserID, r.Action, r.Target, json.RawMessage(r.Details), r.Ip, r.CreatedAt})
	}
	return out, dbError(e)
}

type logsService struct{ c *Core }

func (s *logsService) Read(ctx context.Context, id string) ([]byte, error) {
	if _, e := authorize(ctx, "logs:read", false); e != nil {
		return nil, e
	}
	if _, e := (&deploysService{s.c}).Get(ctx, id); e != nil {
		return nil, e
	}
	return s.c.LogStore.Read(ctx, id, 4<<20)
}
func (s *logsService) Subscribe(ctx context.Context, topic string) (events.Subscription, error) {
	if _, e := authorize(ctx, "logs:read", false); e != nil {
		return events.Subscription{}, e
	}
	switch {
	case topic == "apps" || topic == "servers" || topic == "deployments":
	case strings.HasPrefix(topic, "deploy/"):
		if _, e := (&deploysService{s.c}).Get(ctx, strings.TrimPrefix(topic, "deploy/")); e != nil {
			return events.Subscription{}, e
		}
	case strings.HasPrefix(topic, "app/"):
		if _, e := (&appsService{s.c}).Get(ctx, strings.TrimPrefix(topic, "app/")); e != nil {
			return events.Subscription{}, e
		}
	default:
		return events.Subscription{}, fail(Validation, "Tópico inválido")
	}
	sub := s.c.Hub.Subscribe(ctx, topic, 128)
	if !strings.HasPrefix(topic, "app/") || s.c.Control == nil {
		return sub, nil
	}
	id := strings.TrimPrefix(topic, "app/")
	app, e := s.c.DB.Queries.GetApp(ctx, id)
	if e != nil {
		sub.Cancel()
		return events.Subscription{}, dbError(e)
	}
	s.c.logMu.Lock()
	if s.c.runtimeWatchers == nil {
		s.c.runtimeWatchers = map[string]int{}
	}
	s.c.runtimeWatchers[id]++
	first := s.c.runtimeWatchers[id] == 1
	s.c.logMu.Unlock()
	if first {
		_ = s.c.Control.Send(ctx, app.ServerID, &agentv1.Command{Action: &agentv1.Command_Logs{Logs: &agentv1.Logs{AppId: id, Follow: true}}})
	}
	var once sync.Once
	release := func() {
		once.Do(func() {
			sub.Cancel()
			s.c.logMu.Lock()
			s.c.runtimeWatchers[id]--
			last := s.c.runtimeWatchers[id] == 0
			if last {
				delete(s.c.runtimeWatchers, id)
			}
			s.c.logMu.Unlock()
			if last {
				c, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
				defer cancel()
				_ = s.c.Control.Send(c, app.ServerID, &agentv1.Command{Action: &agentv1.Command_Logs{Logs: &agentv1.Logs{AppId: id, Follow: false}}})
			}
		})
	}
	stop := context.AfterFunc(ctx, release)
	return events.Subscription{C: sub.C, Cancel: func() { stop(); release() }}, nil
}

func (s *auditService) RecordRequest(ctx context.Context, method, route string, status int) error {
	p, e := CurrentUser(ctx)
	if e != nil {
		p = Principal{ID: "anonymous", IP: p.IP}
	}
	details, _ := json.Marshal(map[string]any{"method": method, "status": status})
	_, e = s.c.DB.Write.ExecContext(ctx, "INSERT INTO audit_log(user_id,action,target,details,ip,created_at) VALUES(?,'http.request',?,?,?,?)", p.ID, route, string(details), p.IP, time.Now().Unix())
	return e
}

func (c *Core) send(ctx context.Context, server string, command *agentv1.Command) error {
	if c.Control == nil {
		return fail(Unavailable, "Agent indisponível")
	}
	if e := c.Control.Send(ctx, server, command); e != nil {
		return fail(Unavailable, "Agent indisponível")
	}
	return nil
}
