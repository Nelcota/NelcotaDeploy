package service

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/mail"
	"net/url"
	"slices"
	"strings"
)

// Notification events people can receive outside the panel.
const (
	EventDeployFailed    = "deploy.failed"
	EventServerOffline   = "server.offline"
	EventDiskFull        = "disk.full"
	EventBackupFailed    = "backup.failed"
	EventUpdateFailed    = "update.failed"
	EventUpdateAvailable = "update.available"
)

// NotificationEvents lists the events in the order the interface shows them.
var NotificationEvents = []string{EventDeployFailed, EventServerOffline, EventDiskFull, EventBackupFailed, EventUpdateFailed, EventUpdateAvailable}

const notifySetting = "notify.config"

// notifyConfig is stored sealed as one setting. It holds secrets (webhook
// URLs carry tokens, the SMTP password), so it is never returned as is.
type notifyConfig struct {
	Webhook *webhookTarget `json:"webhook,omitempty"`
	Email   *emailTarget   `json:"email,omitempty"`
	// Muted lists events that are not sent.
	Muted []string `json:"muted,omitempty"`
}

type webhookTarget struct {
	URL string `json:"url"`
	// Secret signs generic webhook bodies (X-Nelcota-Signature).
	Secret string `json:"secret,omitempty"`
}

type emailTarget struct {
	Host     string   `json:"host"`
	Port     int      `json:"port"`
	Username string   `json:"username,omitempty"`
	Password string   `json:"password,omitempty"`
	From     string   `json:"from"`
	To       []string `json:"to"`
}

func (c notifyConfig) wants(event string) bool { return !slices.Contains(c.Muted, event) }

// NotificationSettings is what administrators see: no secrets.
type NotificationSettings struct {
	// WebhookKind is "slack", "discord", or "webhook"; empty without a webhook.
	WebhookKind string          `json:"webhook_kind,omitempty"`
	WebhookHost string          `json:"webhook_host,omitempty"`
	Signed      bool            `json:"signed"`
	Email       *EmailSettings  `json:"email,omitempty"`
	Muted       map[string]bool `json:"muted"`
}

// EmailSettings is the SMTP configuration without its password.
type EmailSettings struct {
	Host        string   `json:"host"`
	Port        int      `json:"port"`
	Username    string   `json:"username,omitempty"`
	From        string   `json:"from"`
	To          []string `json:"to"`
	HasPassword bool     `json:"has_password"`
}

// NotificationInput changes the configuration. Nil fields keep what is saved,
// so secrets don't need to be entered again.
type NotificationInput struct {
	WebhookURL    *string     `json:"webhook_url,omitempty"`
	WebhookSecret *string     `json:"webhook_secret,omitempty"`
	RemoveWebhook bool        `json:"remove_webhook,omitempty"`
	Email         *EmailInput `json:"email,omitempty"`
	RemoveEmail   bool        `json:"remove_email,omitempty"`
	Muted         []string    `json:"muted"`
}

// EmailInput is the SMTP form. An empty password keeps the saved one.
type EmailInput struct {
	Host     string   `json:"host"`
	Port     int      `json:"port"`
	Username string   `json:"username"`
	Password string   `json:"password"`
	From     string   `json:"from"`
	To       []string `json:"to"`
}

// Notifications configures and tests outside notifications.
type Notifications interface {
	Get(context.Context) (NotificationSettings, error)
	Save(context.Context, NotificationInput) error
	Test(context.Context) error
	// EmailConfigured reports whether invitations can be sent by email.
	EmailConfigured(context.Context) bool
	SendInvitation(context.Context, string, string, string) error
}

type notificationsService struct {
	c *Core
	d *delivery
}

func (s *notificationsService) config(ctx context.Context) (notifyConfig, error) {
	var cfg notifyConfig
	raw, e := s.c.Setting(ctx, notifySetting)
	if e != nil {
		// Not configured yet.
		return cfg, nil
	}
	if e := json.Unmarshal([]byte(raw), &cfg); e != nil {
		return cfg, errors.New("stored notification settings are unreadable")
	}
	return cfg, nil
}

func (s *notificationsService) Get(ctx context.Context) (NotificationSettings, error) {
	if _, e := authorize(ctx, "settings:write", true); e != nil {
		return NotificationSettings{}, e
	}
	cfg, e := s.config(ctx)
	if e != nil {
		return NotificationSettings{}, e
	}
	v := NotificationSettings{Muted: map[string]bool{}}
	for _, m := range cfg.Muted {
		v.Muted[m] = true
	}
	if cfg.Webhook != nil {
		u, _ := url.Parse(cfg.Webhook.URL)
		v.WebhookKind, v.WebhookHost, v.Signed = webhookKind(u), u.Hostname(), cfg.Webhook.Secret != ""
	}
	if m := cfg.Email; m != nil {
		v.Email = &EmailSettings{Host: m.Host, Port: m.Port, Username: m.Username, From: m.From, To: m.To, HasPassword: m.Password != ""}
	}
	return v, nil
}

func (s *notificationsService) Save(ctx context.Context, in NotificationInput) error {
	if _, e := authorize(ctx, "settings:write", true); e != nil {
		return e
	}
	cfg, e := s.config(ctx)
	if e != nil {
		return e
	}
	if e := applyNotificationInput(&cfg, in); e != nil {
		return e
	}
	b, e := json.Marshal(cfg)
	if e != nil {
		return e
	}
	return s.c.saveSetting(ctx, notifySetting, string(b), "notifications.configure")
}

// applyNotificationInput validates the input and merges it into cfg.
func applyNotificationInput(cfg *notifyConfig, in NotificationInput) error {
	for _, m := range in.Muted {
		if !slices.Contains(NotificationEvents, m) {
			return fail(Validation, "Unknown notification event")
		}
	}
	cfg.Muted = slices.Clone(in.Muted)
	switch {
	case in.RemoveWebhook:
		cfg.Webhook = nil
	case in.WebhookURL != nil && *in.WebhookURL != "":
		if e := validateWebhookURL(*in.WebhookURL); e != nil {
			return e
		}
		cfg.Webhook = &webhookTarget{URL: *in.WebhookURL}
	}
	if in.WebhookSecret != nil && cfg.Webhook != nil {
		if len(*in.WebhookSecret) > 256 {
			return fail(Validation, "The signing secret is too long")
		}
		cfg.Webhook.Secret = *in.WebhookSecret
	}
	switch {
	case in.RemoveEmail:
		cfg.Email = nil
	case in.Email != nil:
		m, e := validateEmail(*in.Email, cfg.Email)
		if e != nil {
			return e
		}
		cfg.Email = m
	}
	return nil
}

// validateWebhookURL accepts HTTPS URLs on public hosts. Delivery checks the
// resolved address again, so a name that later points inside is still refused.
func validateWebhookURL(raw string) error {
	u, e := url.Parse(raw)
	if e != nil || len(raw) > 2048 || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
		return fail(Validation, "Use an HTTPS webhook address")
	}
	if ip := net.ParseIP(u.Hostname()); ip != nil && !publicIP(ip) {
		return fail(Validation, "Webhooks can't point to private addresses")
	}
	if strings.EqualFold(u.Hostname(), "localhost") || strings.HasSuffix(strings.ToLower(u.Hostname()), ".localhost") {
		return fail(Validation, "Webhooks can't point to private addresses")
	}
	return nil
}

func validateEmail(in EmailInput, saved *emailTarget) (*emailTarget, error) {
	host := strings.TrimSpace(in.Host)
	if host == "" || len(host) > 253 || strings.ContainsAny(host, " /\r\n") {
		return nil, fail(Validation, "Enter the SMTP server name")
	}
	if in.Port != 465 && in.Port != 587 && in.Port != 2525 {
		return nil, fail(Validation, "Use port 587 (STARTTLS), 2525 (STARTTLS), or 465 (TLS)")
	}
	from, e := mail.ParseAddress(in.From)
	if e != nil || strings.ContainsAny(in.From, "\r\n") {
		return nil, fail(Validation, "Enter a valid sender address")
	}
	if len(in.To) == 0 || len(in.To) > 20 {
		return nil, fail(Validation, "Enter between 1 and 20 recipients")
	}
	to := make([]string, 0, len(in.To))
	for _, r := range in.To {
		a, e := mail.ParseAddress(strings.TrimSpace(r))
		if e != nil || strings.ContainsAny(r, "\r\n") {
			return nil, fail(Validation, "Enter valid recipient addresses")
		}
		to = append(to, a.Address)
	}
	if strings.ContainsAny(in.Username+in.Password, "\r\n") || len(in.Username) > 256 || len(in.Password) > 1024 {
		return nil, fail(Validation, "Invalid SMTP credentials")
	}
	m := &emailTarget{Host: host, Port: in.Port, Username: in.Username, Password: in.Password, From: from.Address, To: to}
	if m.Password == "" && saved != nil && saved.Host == m.Host && saved.Username == m.Username {
		m.Password = saved.Password
	}
	return m, nil
}

// Test sends a test message to every configured channel and reports which failed.
func (s *notificationsService) Test(ctx context.Context) error {
	if _, e := authorize(ctx, "settings:write", true); e != nil {
		return e
	}
	cfg, e := s.config(ctx)
	if e != nil {
		return e
	}
	if cfg.Webhook == nil && cfg.Email == nil {
		return fail(Validation, "Add a webhook or email first")
	}
	n := Notification{Event: "test", Title: "Test notification from NelcotaDeploy", Detail: "Notifications reach this channel.", Link: s.d.origin + "/settings/github#notifications"}
	if failed := s.d.deliver(ctx, cfg, n, 1); len(failed) > 0 {
		return fail(Unavailable, strings.Join(failed, " "))
	}
	return nil
}

func (s *notificationsService) EmailConfigured(ctx context.Context) bool {
	cfg, e := s.config(ctx)
	return e == nil && cfg.Email != nil
}

// SendInvitation emails an enrollment link. The token travels in the URL
// fragment, which browsers never send to servers or proxies.
func (s *notificationsService) SendInvitation(ctx context.Context, to, name, token string) error {
	if _, e := authorize(ctx, "users:write", true); e != nil {
		return e
	}
	cfg, e := s.config(ctx)
	if e != nil {
		return e
	}
	if cfg.Email == nil {
		return fail(Unavailable, "Email is not configured")
	}
	addr, e := mail.ParseAddress(to)
	if e != nil {
		return fail(Validation, "Enter a valid email address")
	}
	m := *cfg.Email
	m.To = []string{addr.Address}
	body := "Hello " + oneLine(name) + ",\n\nYou were invited to NelcotaDeploy. Open this link within 24 hours and create a passkey:\n\n" + s.d.origin + "/enroll#token=" + url.QueryEscape(token) + "\n\nThe link works once. If you didn't expect it, ignore this email.\n"
	if e := s.d.mail(ctx, m, "Your NelcotaDeploy invitation", body); e != nil {
		return fail(Unavailable, "The invitation email couldn't be sent: "+e.Error())
	}
	return nil
}

// oneLine collapses whitespace and line breaks; header values use it so they
// cannot add mail headers.
func oneLine(s string) string {
	return strings.Join(strings.Fields(strings.NewReplacer("\r", " ", "\n", " ").Replace(s)), " ")
}
