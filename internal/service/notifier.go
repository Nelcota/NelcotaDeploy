package service

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/url"
	"sync"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/events"
)

// Notifier turns panel events into outside notifications. It reads the
// configuration only when something is worth sending, limits repeats of the
// same problem, and delivers in the background so events never wait on a
// slow webhook or mail server.
type Notifier struct {
	c        *Core
	d        *delivery
	queue    chan Notification
	mu       sync.Mutex
	lastSent map[string]time.Time
	now      func() time.Time
}

// Repeat limits per kind of problem; a problem that persists is not re-sent
// more often than this.
var notifyCooldown = map[string]time.Duration{
	EventServerOffline:   time.Hour,
	EventDiskFull:        6 * time.Hour,
	EventBackupFailed:    6 * time.Hour,
	EventUpdateAvailable: 24 * time.Hour,
}

// notifyDiskPercent is above the automatic cleanup threshold: people hear
// about a full disk only when cleaning unused images wasn't enough.
const notifyDiskPercent = 90

const notifyQueue = 64

// NewNotifier creates the notifier for the panel at origin.
func NewNotifier(c *Core, origin string) *Notifier {
	return &Notifier{c: c, d: &delivery{origin: origin}, queue: make(chan Notification, notifyQueue), lastSent: map[string]time.Time{}, now: time.Now}
}

// Service returns the configuration service backed by this notifier's delivery.
func (n *Notifier) Service() Notifications { return &notificationsService{c: n.c, d: n.d} }

// Run subscribes to panel events and delivers notifications until ctx ends.
func (n *Notifier) Run(ctx context.Context) error {
	ctx = systemContext(ctx)
	topics := []string{"deployments", "servers", "operations"}
	merged := make(chan events.Event, 256)
	for _, t := range topics {
		sub := n.c.Hub.Subscribe(ctx, t, 256)
		defer sub.Cancel()
		go func() {
			for ev := range sub.C {
				select {
				case merged <- ev:
				case <-ctx.Done():
					return
				}
			}
		}()
	}
	go n.deliverQueued(ctx)
	for {
		select {
		case <-ctx.Done():
			return nil
		case ev := <-merged:
			if note, ok := n.translate(ctx, ev); ok {
				n.enqueue(note)
			}
		}
	}
}

// enqueue drops the notification when the queue is full rather than blocking
// event handling; a backlog that large means channels are failing anyway.
func (n *Notifier) enqueue(note Notification) {
	select {
	case n.queue <- note:
	default:
		slog.Warn("notification dropped: queue full", "event", note.Event)
	}
}

func (n *Notifier) deliverQueued(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case note := <-n.queue:
			cfg, e := (&notificationsService{c: n.c, d: n.d}).config(ctx)
			if e != nil {
				slog.Warn("notification settings unreadable", "err", e)
				continue
			}
			if !cfg.wants(note.Event) {
				continue
			}
			for _, failure := range n.d.deliver(ctx, cfg, note, 3) {
				slog.Warn("notification not delivered", "event", note.Event, "reason", failure)
			}
		}
	}
}

// allow reports whether a notification for key may be sent now.
func (n *Notifier) allow(event, key string) bool {
	wait, limited := notifyCooldown[event]
	if !limited {
		return true
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	now := n.now()
	if t, ok := n.lastSent[event+"/"+key]; ok && now.Sub(t) < wait {
		return false
	}
	n.lastSent[event+"/"+key] = now
	return true
}

func (n *Notifier) link(path string) string { return n.d.origin + path }

// translate maps an event to a notification, or reports false to skip it.
func (n *Notifier) translate(ctx context.Context, ev events.Event) (Notification, bool) {
	switch ev.Kind {
	case "deploy.status":
		var d Deployment
		if json.Unmarshal(ev.Data, &d) != nil || d.Status != "failed" || ev.Topic != "deployments" {
			return Notification{}, false
		}
		// A failure that is being retried automatically is not news yet.
		var retries int
		if e := n.c.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM deployments WHERE retry_of=?", d.ID).Scan(&retries); e != nil || retries > 0 {
			return Notification{}, false
		}
		app, e := (&appsService{n.c}).Get(ctx, d.AppID)
		if e != nil {
			return Notification{}, false
		}
		return Notification{Event: EventDeployFailed, Title: app.Name + " didn't go live", Detail: "Version " + shortSHA(d.SHA) + " failed (" + d.ErrorCode + "). The previous version is still online.", Link: n.link("/apps/" + url.PathEscape(app.ID))}, true
	case "server.offline":
		var v struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(ev.Data, &v) != nil || !n.allow(EventServerOffline, v.ID) {
			return Notification{}, false
		}
		return Notification{Event: EventServerOffline, Title: n.serverName(ctx, v.ID) + " is offline", Detail: "Its apps keep running. New deployments wait until it reconnects.", Link: n.link("/servers")}, true
	case "server.metrics":
		var v struct {
			ServerID string `json:"server_id"`
			Metrics  struct {
				DiskUsed  uint64 `json:"disk_used"`
				DiskTotal uint64 `json:"disk_total"`
			} `json:"metrics"`
		}
		if json.Unmarshal(ev.Data, &v) != nil || v.Metrics.DiskTotal == 0 || v.Metrics.DiskUsed*100 < v.Metrics.DiskTotal*notifyDiskPercent || !n.allow(EventDiskFull, v.ServerID) {
			return Notification{}, false
		}
		return Notification{Event: EventDiskFull, Title: n.serverName(ctx, v.ServerID) + " is almost out of disk space", Detail: "Unused images were already removed. Builds can fail until space is freed or the disk is enlarged.", Link: n.link("/servers")}, true
	case "backup.failed":
		if !n.allow(EventBackupFailed, "panel") {
			return Notification{}, false
		}
		return Notification{Event: EventBackupFailed, Title: "A backup failed", Detail: "The panel retries daily backups every hour. Check the backup settings and free disk space.", Link: n.link("/settings/platform#backups")}, true
	case "backup.unverified":
		if !n.allow(EventBackupFailed, "verify") {
			return Notification{}, false
		}
		return Notification{Event: EventBackupFailed, Title: "The newest backup can't be restored", Detail: "The weekly test restore failed. Take a new backup and check the backup key; older backups may still work.", Link: n.link("/settings/platform#backups")}, true
	case "update.failed":
		var v struct {
			Version string `json:"version"`
			Code    string `json:"code"`
		}
		if json.Unmarshal(ev.Data, &v) != nil {
			return Notification{}, false
		}
		return Notification{Event: EventUpdateFailed, Title: "The update to " + v.Version + " stopped", Detail: "The remaining steps were cancelled (" + v.Code + "). Servers that weren't updated keep their version.", Link: n.link("/settings/platform")}, true
	case "update.available":
		var v struct {
			Version string `json:"version"`
		}
		if json.Unmarshal(ev.Data, &v) != nil || !n.allow(EventUpdateAvailable, v.Version) {
			return Notification{}, false
		}
		return Notification{Event: EventUpdateAvailable, Title: "NelcotaDeploy " + v.Version + " is available", Detail: "A signed release is ready to install.", Link: n.link("/settings/platform")}, true
	}
	return Notification{}, false
}

func (n *Notifier) serverName(ctx context.Context, id string) string {
	var name string
	if e := n.c.DB.Read.QueryRowContext(ctx, "SELECT name FROM servers WHERE id=?", id).Scan(&name); e != nil {
		return "A server"
	}
	return name
}

func shortSHA(sha string) string {
	if len(sha) > 7 {
		return sha[:7]
	}
	return sha
}
