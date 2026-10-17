package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/events"
)

type Kind string

const (
	NotFound        Kind = "not_found"
	Forbidden       Kind = "forbidden"
	Validation      Kind = "validation"
	Conflict        Kind = "conflict"
	Unauthenticated Kind = "unauthenticated"
	Unavailable     Kind = "unavailable"
)

type Error struct {
	Kind    Kind   `json:"code"`
	Message string `json:"message"`
	// cause keeps the underlying failure for logs; it is never shown to users.
	cause error
}

func (e *Error) Error() string             { return e.Message }
func (e *Error) Unwrap() error             { return e.cause }
func fail(kind Kind, message string) error { return &Error{Kind: kind, Message: message} }
func Is(err error, kind Kind) bool         { var e *Error; return errors.As(err, &e) && e.Kind == kind }

type Principal struct {
	Scopes      []string `json:"scopes,omitempty"`
	ID          string   `json:"id"`
	Email       string   `json:"email"`
	Name        string   `json:"name"`
	Role        string   `json:"role"`
	AvatarAt    int64    `json:"avatar_at,omitempty"`
	TwoFactorAt int64    `json:"-"`
	IP          string   `json:"-"`
}
type principalKey struct{}

func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, p)
}
func CurrentUser(ctx context.Context) (Principal, error) {
	p, ok := ctx.Value(principalKey{}).(Principal)
	if !ok || p.ID == "" {
		return p, fail(Unauthenticated, "Authentication required")
	}
	return p, nil
}
func require(ctx context.Context, admin bool) (Principal, error) {
	p, e := CurrentUser(ctx)
	if e != nil {
		return p, e
	}
	if admin && p.Role != "admin" {
		return p, fail(Forbidden, "Administrator permission required")
	}
	return p, nil
}
func systemContext(ctx context.Context) context.Context {
	p, _ := CurrentUser(ctx)
	return WithPrincipal(ctx, Principal{ID: "system", Role: "admin", IP: p.IP})
}

type App struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	ServerID   string    `json:"server_id"`
	Repository string    `json:"repository"`
	Branch     string    `json:"branch"`
	Config     AppConfig `json:"config"`
	DesiredSHA string    `json:"desired_sha"`
	Revision   int64     `json:"revision"`
	LogoAt     int64     `json:"logo_at,omitempty"`
}
type AppConfig struct {
	Domains        []string `json:"domains"`
	MemoryBytes    int64    `json:"memory_bytes"`
	NanoCPUs       int64    `json:"nano_cpus"`
	Port           uint32   `json:"port"`
	HealthPath     string   `json:"health_path"`
	HealthTimeout  uint32   `json:"health_timeout"`
	Replicas       uint32   `json:"replicas"`
	CacheEnabled   bool     `json:"cache_enabled"`
	Dockerfile     string   `json:"dockerfile"`
	InstallationID int64    `json:"installation_id"`
	Stopped        bool     `json:"stopped"`
	// Runtime names the app's language or server (see Runtimes), detected from
	// the Dockerfile or chosen in settings. Empty when unknown.
	Runtime string `json:"runtime,omitempty"`
}
type AppInput struct {
	Name       string    `json:"name"`
	ServerID   string    `json:"server_id"`
	Repository string    `json:"repository"`
	Branch     string    `json:"branch"`
	Config     AppConfig `json:"config"`
}
type EnvInput struct {
	Delete bool   `json:"delete"`
	Key    string `json:"key"`
	Value  string `json:"value"`
	Build  bool   `json:"build"`
}
type EnvInfo struct {
	Key        string `json:"key"`
	Build      bool   `json:"build"`
	Configured bool   `json:"configured"`
}
type Deployment struct {
	CancelRequested bool             `json:"cancel_requested"`
	Timings         map[string]int64 `json:"timings"`
	ID              string           `json:"id"`
	AppID           string           `json:"app_id"`
	SHA             string           `json:"sha"`
	Message         string           `json:"message"`
	Author          string           `json:"author"`
	Origin          string           `json:"origin"`
	Status          string           `json:"status"`
	QueuedAt        int64            `json:"queued_at"`
	StartedAt       int64            `json:"started_at"`
	FinishedAt      int64            `json:"finished_at"`
	ErrorCode       string           `json:"error_code"`
	Clean           bool             `json:"clean"`
	// RetryOf is the failed deployment this one retries automatically.
	RetryOf string `json:"retry_of,omitempty"`
}
type DeployInput struct {
	AppID   string `json:"app_id"`
	SHA     string `json:"sha"`
	Message string `json:"message"`
	Author  string `json:"author"`
	Origin  string `json:"origin"`
	Clean   bool   `json:"clean"`
	// retryOf is set only by the automatic retry, never by callers.
	retryOf string
}
type Server struct {
	Ready       bool   `json:"ready"`
	Version     string `json:"version"`
	ID          string `json:"id"`
	Name        string `json:"name"`
	WireGuardIP string `json:"wireguard_ip"`
	Status      string `json:"status"`
	HeartbeatAt int64  `json:"heartbeat_at"`
	BuildLimit  int64  `json:"build_limit"`
	CacheBytes  int64  `json:"cache_bytes"`
}
type ServerLimitsInput struct {
	BuildLimit int   `json:"build_limit"`
	CacheBytes int64 `json:"cache_bytes"`
}
type ServerInput struct {
	Name        string `json:"name"`
	WireGuardIP string `json:"wireguard_ip"`
	BuildLimit  int    `json:"build_limit"`
	CacheBytes  int64  `json:"cache_bytes"`
}
type Invitation struct {
	ServerID  string    `json:"server_id"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	// Server is the newly created, not yet enrolled server.
	Server Server `json:"-"`
}
type AuditEntry struct {
	ID        int64           `json:"id"`
	UserID    string          `json:"user_id"`
	Action    string          `json:"action"`
	Target    string          `json:"target"`
	Details   json.RawMessage `json:"details"`
	IP        string          `json:"ip"`
	CreatedAt int64           `json:"created_at"`
}
type SettingsView struct {
	Configured []string `json:"configured"`
}

type Apps interface {
	List(context.Context) ([]App, error)
	Get(context.Context, string) (App, error)
	Create(context.Context, AppInput) (App, error)
	Update(context.Context, string, AppInput) (App, error)
	Delete(context.Context, string, bool) error
	Environment(context.Context, string) ([]EnvInfo, error)
	SetEnvironment(context.Context, string, []EnvInput) error
	Action(context.Context, string, string, uint32, bool) error
	CheckDomains(context.Context, string) ([]DomainCheck, error)
	SetLogo(context.Context, string, []byte) error
	RemoveLogo(context.Context, string) error
	Logo(context.Context, string) (Logo, error)
}
type Deploys interface {
	List(context.Context, string) ([]Deployment, error)
	Get(context.Context, string) (Deployment, error)
	Enqueue(context.Context, DeployInput) (Deployment, error)
	Cancel(context.Context, string) error
	Rollback(context.Context, string, string) (Deployment, error)
	SuggestedPort(context.Context, string) (uint32, error)
	PublishOnPort(context.Context, string, uint32) (Deployment, error)
}
type Servers interface {
	UpdateLimits(context.Context, string, ServerLimitsInput) (Server, error)
	List(context.Context) ([]Server, error)
	Invite(context.Context, ServerInput) (Invitation, error)
	Prune(context.Context, string, string, bool) error
}
type Logs interface {
	Read(context.Context, string) ([]byte, error)
	Subscribe(context.Context, string) (events.Subscription, error)
}
type Settings interface {
	Get(context.Context) (SettingsView, error)
	Set(context.Context, string, string) error
	// TestS3 checks an S3 configuration (JSON, as saved) by storing and
	// deleting a small object.
	TestS3(context.Context, string) error
}
type Audit interface {
	RecordRequest(context.Context, string, string, int) error
	List(context.Context, int) ([]AuditEntry, error)
}
type Services struct {
	Apps       Apps
	Deploys    Deploys
	Servers    Servers
	Logs       Logs
	Auth       Auth
	Users      Users
	Settings   Settings
	Audit      Audit
	Operations Operations
	// Repos is optional (nil without GitHub access).
	Repos Repos
	// Notifications is optional (nil when the panel sends none).
	Notifications Notifications
	// Provisioning is optional (nil when servers are added by hand only).
	Provisioning Provisioning
}
