package service

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/updater"
)

const (
	updateCheckInterval = 6 * time.Hour
	firstUpdateCheck    = time.Minute
)

// UpdateStatus tells administrators whether a newer signed release exists.
type UpdateStatus struct {
	Current   string `json:"current"`
	Available string `json:"available,omitempty"`
	Automatic bool   `json:"automatic"`
	CheckedAt int64  `json:"checked_at,omitempty"`
	// Configured is false when the panel has no release identity to check against.
	Configured bool `json:"configured"`
}

// updateState is the result of the last release check.
type updateState struct {
	mu        sync.Mutex
	available string
	checkedAt int64
}

func (u *updateState) get() (string, int64) {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.available, u.checkedAt
}

// set records a check and reports whether the available version changed.
func (u *updateState) set(version string, at int64) bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	changed := u.available != version
	u.available, u.checkedAt = version, at
	return changed
}

func (s *OperationsService) configuredForUpdates() bool {
	return s.LatestRelease != nil && s.VerifyRelease != nil && s.QueuePanel != nil
}

func (s *OperationsService) automaticUpdates(ctx context.Context) bool {
	v, e := s.Core.Setting(ctx, "updates.automatic")
	return e == nil && v == "true"
}

// Updates returns the installed version and any newer signed release.
func (s *OperationsService) Updates(ctx context.Context) (UpdateStatus, error) {
	if _, e := authorize(ctx, "settings:write", true); e != nil {
		return UpdateStatus{}, e
	}
	available, checked := s.updates.get()
	return UpdateStatus{Current: s.Version, Available: available, CheckedAt: checked, Automatic: s.automaticUpdates(ctx), Configured: s.configuredForUpdates()}, nil
}

// SetAutomaticUpdates turns automatic installation of signed releases on or off.
func (s *OperationsService) SetAutomaticUpdates(ctx context.Context, on bool) error {
	if _, e := freshInteractive(ctx, true); e != nil {
		return e
	}
	value := "false"
	if on {
		value = "true"
	}
	return (&settingsService{s.Core}).Set(ctx, "updates.automatic", value)
}

// checkUpdates looks for a newer release, verifies its signature, announces
// it, and queues it when automatic updates are on. Errors are logged: a release
// location being unreachable must not affect the panel.
func (s *OperationsService) checkUpdates(ctx context.Context) {
	if !s.configuredForUpdates() {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	latest, e := s.LatestRelease(ctx)
	if e != nil {
		slog.Info("release check failed", "err", e)
		return
	}
	now := time.Now().Unix()
	if !updater.Newer(latest, s.Version) {
		s.updates.set("", now)
		return
	}
	if e := s.VerifyRelease(ctx, latest); e != nil {
		slog.Warn("announced release failed verification", "version", latest, "err", e)
		return
	}
	if s.updates.set(latest, now) {
		s.Core.publish("operations", "update.available", map[string]string{"version": latest, "current": s.Version})
	}
	if !s.automaticUpdates(ctx) {
		return
	}
	if _, e := s.queueUpdate(systemContext(ctx), latest); e != nil && !Is(e, Conflict) {
		slog.Warn("automatic update not queued", "version", latest, "err", e)
	}
}
