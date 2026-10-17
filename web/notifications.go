package web

import (
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/Nelcota/NelcotaDeploy/web/i18n"
	"github.com/Nelcota/NelcotaDeploy/web/pages"
)

// notificationInput reads the notifications form. Empty secret fields keep
// the saved values; an empty SMTP server leaves email unchanged.
func notificationInput(r *http.Request) (service.NotificationInput, error) {
	if err := r.ParseForm(); err != nil {
		return service.NotificationInput{}, invalid("Invalid form")
	}
	f := r.PostForm
	in := service.NotificationInput{Muted: []string{}}
	enabled := f["event"]
	for _, ev := range service.NotificationEvents {
		if !slices.Contains(enabled, ev) {
			in.Muted = append(in.Muted, ev)
		}
	}
	if u := strings.TrimSpace(f.Get("webhook_url")); u != "" {
		in.WebhookURL = &u
	}
	if s := f.Get("webhook_secret"); s != "" {
		in.WebhookSecret = &s
	}
	if host := strings.TrimSpace(f.Get("smtp_host")); host != "" {
		port, err := strconv.Atoi(f.Get("smtp_port"))
		if err != nil {
			return in, invalid("Use port 587 (STARTTLS), 2525 (STARTTLS), or 465 (TLS)")
		}
		var to []string
		for _, a := range strings.Split(f.Get("smtp_to"), ",") {
			if a = strings.TrimSpace(a); a != "" {
				to = append(to, a)
			}
		}
		in.Email = &service.EmailInput{Host: host, Port: port, Username: strings.TrimSpace(f.Get("smtp_username")), Password: f.Get("smtp_password"), From: strings.TrimSpace(f.Get("smtp_from")), To: to}
	}
	return in, nil
}

func (h *handler) saveNotifications(w http.ResponseWriter, r *http.Request) {
	h.notificationAction(w, r, "Notifications saved.", func(n service.Notifications) error {
		in, err := notificationInput(r)
		if err != nil {
			return err
		}
		return n.Save(r.Context(), in)
	})
}

func (h *handler) removeNotificationWebhook(w http.ResponseWriter, r *http.Request) {
	h.notificationAction(w, r, "Webhook removed.", func(n service.Notifications) error {
		current, err := n.Get(r.Context())
		if err != nil {
			return err
		}
		return n.Save(r.Context(), service.NotificationInput{RemoveWebhook: true, Muted: mutedList(current)})
	})
}

func (h *handler) removeNotificationEmail(w http.ResponseWriter, r *http.Request) {
	h.notificationAction(w, r, "Email removed.", func(n service.Notifications) error {
		current, err := n.Get(r.Context())
		if err != nil {
			return err
		}
		return n.Save(r.Context(), service.NotificationInput{RemoveEmail: true, Muted: mutedList(current)})
	})
}

func (h *handler) testNotifications(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		if h.s.Notifications == nil {
			return &service.Error{Kind: service.Unavailable, Message: "Notifications are unavailable"}
		}
		if err := h.s.Notifications.Test(r.Context()); err != nil {
			return err
		}
		return s.toast("success", i18n.T(r.Context(), "Test sent. Check your channels."))
	})
}

func mutedList(n service.NotificationSettings) []string {
	var out []string
	for _, ev := range service.NotificationEvents {
		if n.Muted[ev] {
			out = append(out, ev)
		}
	}
	return out
}

// notificationAction runs a change and redraws the card with a confirmation.
func (h *handler) notificationAction(w http.ResponseWriter, r *http.Request, done string, change func(service.Notifications) error) {
	h.act(w, r, func(s *stream) error {
		if h.s.Notifications == nil {
			return &service.Error{Kind: service.Unavailable, Message: "Notifications are unavailable"}
		}
		if err := change(h.s.Notifications); err != nil {
			return err
		}
		n, err := h.s.Notifications.Get(r.Context())
		if err != nil {
			return err
		}
		if err := s.patch(pages.NotificationsCard(n), "", ""); err != nil {
			return err
		}
		// Clear typed secrets; other fields reset to the saved values.
		if err := s.closeAndReset("#notify-form"); err != nil {
			return err
		}
		return s.toast("success", i18n.T(r.Context(), done))
	})
}
