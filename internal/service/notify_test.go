package service

import (
	"bufio"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/events"
)

func TestWebhookAddressesMustBePublicHTTPS(t *testing.T) {
	for _, ok := range []string{"https://hooks.slack.com/services/T/B/x", "https://discord.com/api/webhooks/1/abc", "https://example.com/hook?key=1"} {
		if e := validateWebhookURL(ok); e != nil {
			t.Errorf("%s: %v", ok, e)
		}
	}
	for _, bad := range []string{"http://example.com/hook", "https://localhost/hook", "https://app.localhost/x", "https://127.0.0.1/x", "https://10.77.0.2/x", "https://169.254.169.254/latest", "https://[::1]/x", "https://user:pass@example.com/x", "ftp://example.com", "https://"} {
		if e := validateWebhookURL(bad); !Is(e, Validation) {
			t.Errorf("accepted %s", bad)
		}
	}
	addresses := map[string]bool{
		"8.8.8.8": true, "2606:4700::1111": true,
		"127.0.0.1": false, "10.0.0.1": false, "172.16.0.1": false, "192.168.1.1": false, "169.254.169.254": false,
		"100.64.1.1": false, "0.0.0.0": false, "::1": false, "fe80::1": false, "fc00::1": false, "::ffff:10.0.0.1": false, "224.0.0.1": false,
	}
	for ip, public := range addresses {
		if publicIP(net.ParseIP(ip)) != public {
			t.Errorf("%s: public=%v", ip, !public)
		}
	}
	// Names that resolve to private addresses are refused at connection time.
	if _, e := publicDialer(context.Background(), "tcp", "localhost:443"); e == nil {
		t.Fatal("dialed localhost")
	}
}

func TestChatWebhooksCannotMentionEveryone(t *testing.T) {
	n := Notification{Event: EventDeployFailed, Title: "<!channel> api @everyone", Detail: "x & <y>", Link: "https://panel.example.com/apps/a"}
	b, _ := webhookBody("slack", n)
	var slack struct{ Text string }
	if json.Unmarshal(b, &slack) != nil || strings.Contains(slack.Text, "<!channel>") || !strings.Contains(slack.Text, "&lt;!channel&gt;") || !strings.Contains(slack.Text, "<https://panel.example.com/apps/a|") {
		t.Fatal(slack.Text)
	}
	b, _ = webhookBody("discord", n)
	var d struct {
		AllowedMentions struct {
			Parse []string `json:"parse"`
		} `json:"allowed_mentions"`
	}
	if json.Unmarshal(b, &d) != nil || d.AllowedMentions.Parse == nil || len(d.AllowedMentions.Parse) != 0 {
		t.Fatal(string(b))
	}
}

func TestGenericWebhookIsSigned(t *testing.T) {
	var got struct {
		sig, event string
		body       []byte
	}
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.sig, got.event = r.Header.Get("X-Nelcota-Signature"), r.Header.Get("X-Nelcota-Event")
		got.body, _ = io.ReadAll(r.Body)
	}))
	defer srv.Close()
	d := &delivery{client: srv.Client()}
	if e := d.post(context.Background(), webhookTarget{URL: srv.URL + "/hook", Secret: "s3cret"}, Notification{Event: EventDiskFull, Title: "t"}); e != nil {
		t.Fatal(e)
	}
	mac := hmac.New(sha256.New, []byte("s3cret"))
	mac.Write(got.body)
	if got.event != EventDiskFull || got.sig != "sha256="+hex.EncodeToString(mac.Sum(nil)) {
		t.Fatal(got.event, got.sig)
	}
	// Redirects are not followed and errors don't leak the address.
	redirect := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://10.0.0.1/", http.StatusFound)
	}))
	defer redirect.Close()
	d.client = redirect.Client()
	d.client.CheckRedirect = publicClient().CheckRedirect
	if e := d.post(context.Background(), webhookTarget{URL: redirect.URL}, Notification{}); e == nil || strings.Contains(e.Error(), "10.0.0.1") {
		t.Fatal(e)
	}
}

func TestNotificationSettingsHideSecrets(t *testing.T) {
	c, ctx, _ := fixture(t)
	s := &notificationsService{c: c, d: &delivery{origin: "https://panel.example.com"}}
	hook, secret := "https://hooks.slack.com/services/T0/B0/token-value", "sign-me"
	in := NotificationInput{WebhookURL: &hook, WebhookSecret: &secret, Email: &EmailInput{Host: "smtp.example.com", Port: 587, Username: "bot", Password: "mail-password", From: "Panel <panel@example.com>", To: []string{"ops@example.com"}}, Muted: []string{EventUpdateAvailable}}
	if e := s.Save(ctx, in); e != nil {
		t.Fatal(e)
	}
	v, e := s.Get(ctx)
	if e != nil {
		t.Fatal(e)
	}
	b, _ := json.Marshal(v)
	if strings.Contains(string(b), "token-value") || strings.Contains(string(b), "mail-password") || strings.Contains(string(b), "sign-me") {
		t.Fatal("secret returned", string(b))
	}
	if v.WebhookKind != "slack" || v.WebhookHost != "hooks.slack.com" || !v.Signed || v.Email == nil || !v.Email.HasPassword || v.Email.From != "panel@example.com" || !v.Muted[EventUpdateAvailable] {
		t.Fatalf("%+v", v)
	}
	// Saving the form again without secrets keeps them.
	if e := s.Save(ctx, NotificationInput{Email: &EmailInput{Host: "smtp.example.com", Port: 587, Username: "bot", From: "panel@example.com", To: []string{"ops@example.com"}}}); e != nil {
		t.Fatal(e)
	}
	cfg, _ := s.config(ctx)
	if cfg.Email.Password != "mail-password" || cfg.Webhook == nil || cfg.Webhook.URL != hook || len(cfg.Muted) != 0 {
		t.Fatalf("%+v", cfg)
	}
	for _, bad := range []NotificationInput{
		{Muted: []string{"nope"}},
		{Email: &EmailInput{Host: "smtp.example.com", Port: 25, From: "a@example.com", To: []string{"b@example.com"}}},
		{Email: &EmailInput{Host: "smtp.example.com", Port: 587, From: "a@example.com\r\nBcc: x@example.com", To: []string{"b@example.com"}}},
		{Email: &EmailInput{Host: "smtp.example.com", Port: 587, From: "a@example.com", To: nil}},
	} {
		if e := s.Save(ctx, bad); !Is(e, Validation) {
			t.Errorf("%+v: %v", bad, e)
		}
	}
	if e := s.Save(WithPrincipal(ctx, Principal{ID: "m", Role: "member"}), NotificationInput{}); !Is(e, Forbidden) {
		t.Fatal(e)
	}
}

func TestNotifierTranslatesAndLimitsRepeats(t *testing.T) {
	c, ctx, a := fixture(t)
	n := NewNotifier(c, "https://panel.example.com")
	event := func(topic, kind string, v any) Notification {
		t.Helper()
		b, _ := json.Marshal(v)
		note, _ := n.translate(ctx, events.Event{Topic: topic, Kind: kind, Data: b})
		return note
	}
	d, _ := (&deploysService{c}).Enqueue(ctx, DeployInput{AppID: a.ID, SHA: strings.Repeat("a", 40)})
	d.Status, d.ErrorCode = "failed", "build_failed"
	if note := event("deployments", "deploy.status", d); note.Event != EventDeployFailed || !strings.Contains(note.Title, a.Name) || note.Link != "https://panel.example.com/apps/"+a.ID {
		t.Fatalf("%+v", note)
	}
	// The same event on the per-deployment topic is ignored, so it isn't sent twice.
	if note := event("deploy/"+d.ID, "deploy.status", d); note.Event != "" {
		t.Fatal("duplicate topic notified")
	}
	if _, e := c.DB.Write.ExecContext(ctx, "INSERT INTO deployments(id,app_id,sha,origin,status,queued_at,retry_of) VALUES('r',?,?,'manual','queued',0,?)", a.ID, d.SHA, d.ID); e != nil {
		t.Fatal(e)
	}
	if note := event("deployments", "deploy.status", d); note.Event != "" {
		t.Fatal("notified a failure that is being retried")
	}
	if note := event("servers", "server.offline", map[string]string{"id": a.ServerID}); note.Event != EventServerOffline {
		t.Fatal(note)
	}
	if note := event("servers", "server.offline", map[string]string{"id": a.ServerID}); note.Event != "" {
		t.Fatal("repeated within the cooldown")
	}
	n.now = func() time.Time { return time.Now().Add(2 * time.Hour) }
	if note := event("servers", "server.offline", map[string]string{"id": a.ServerID}); note.Event != EventServerOffline {
		t.Fatal("not sent after the cooldown")
	}
	disk := func(used uint64) map[string]any {
		return map[string]any{"server_id": a.ServerID, "metrics": map[string]uint64{"disk_used": used, "disk_total": 100}}
	}
	if note := event("servers", "server.metrics", disk(89)); note.Event != "" {
		t.Fatal("notified below the threshold")
	}
	if note := event("servers", "server.metrics", disk(95)); note.Event != EventDiskFull {
		t.Fatal(note)
	}
}

func TestNotifierDeliversInTheBackground(t *testing.T) {
	c, ctx, a := fixture(t)
	received := make(chan string, 4)
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		received <- string(b)
	}))
	defer srv.Close()
	n := NewNotifier(c, "https://panel.example.com")
	n.d.client = srv.Client()
	hook := srv.URL + "/hook"
	cfg, _ := json.Marshal(notifyConfig{Webhook: &webhookTarget{URL: hook}, Muted: []string{EventDiskFull}})
	if e := c.saveSetting(ctx, notifySetting, string(cfg), "notifications.configure"); e != nil {
		t.Fatal(e)
	}
	run, stop := context.WithCancel(ctx)
	defer stop()
	go func() { _ = n.Run(run) }()
	time.Sleep(50 * time.Millisecond) // let the subscriptions start
	c.publish("servers", "server.metrics", map[string]any{"server_id": a.ServerID, "metrics": map[string]uint64{"disk_used": 99, "disk_total": 100}})
	c.publish("servers", "server.offline", map[string]string{"id": a.ServerID})
	select {
	case body := <-received:
		if !strings.Contains(body, "is offline") {
			t.Fatal("muted event delivered or wrong body:", body)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("nothing delivered")
	}
	select {
	case body := <-received:
		t.Fatal("muted event delivered:", body)
	case <-time.After(200 * time.Millisecond):
	}
}

// fakeSMTP is a minimal SMTP server for tests. With startTLS it requires the
// client to upgrade before AUTH, like real submission servers.
type fakeSMTP struct {
	addr     string
	cert     tls.Certificate
	startTLS bool
	mu       sync.Mutex
	authed   string
	data     string
	tlsSeen  bool
}

func newFakeSMTP(t *testing.T, startTLS bool) (*fakeSMTP, *x509.CertPool) {
	t.Helper()
	srv := httptest.NewUnstartedServer(nil)
	srv.StartTLS()
	cert := srv.TLS.Certificates[0]
	pool := x509.NewCertPool()
	pool.AddCert(srv.Certificate())
	srv.Close()
	l, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = l.Close() })
	f := &fakeSMTP{addr: l.Addr().String(), cert: cert, startTLS: startTLS}
	go func() {
		for {
			conn, e := l.Accept()
			if e != nil {
				return
			}
			go f.serve(conn)
		}
	}()
	return f, pool
}

func (f *fakeSMTP) serve(conn net.Conn) {
	defer conn.Close()
	r, w := bufio.NewReader(conn), conn
	say := func(s string) { _, _ = io.WriteString(w, s+"\r\n") }
	say("220 fake ESMTP")
	secure := false
	for {
		line, e := r.ReadString('\n')
		if e != nil {
			return
		}
		cmd := strings.ToUpper(strings.TrimSpace(line))
		switch {
		case strings.HasPrefix(cmd, "EHLO"):
			if f.startTLS && !secure {
				say("250-fake\r\n250-STARTTLS\r\n250 8BITMIME")
			} else {
				say("250-fake\r\n250-AUTH PLAIN\r\n250 8BITMIME")
			}
		case cmd == "STARTTLS":
			say("220 go ahead")
			tc := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{f.cert}})
			if tc.Handshake() != nil {
				return
			}
			conn, r, w, secure = tc, bufio.NewReader(tc), tc, true
			f.mu.Lock()
			f.tlsSeen = true
			f.mu.Unlock()
		case strings.HasPrefix(cmd, "AUTH PLAIN"):
			raw, _ := base64.StdEncoding.DecodeString(strings.TrimSpace(line)[len("AUTH PLAIN "):])
			f.mu.Lock()
			f.authed = string(raw)
			f.mu.Unlock()
			say("235 ok")
		case strings.HasPrefix(cmd, "MAIL"), strings.HasPrefix(cmd, "RCPT"):
			say("250 ok")
		case cmd == "DATA":
			say("354 go")
			var b strings.Builder
			for {
				l, e := r.ReadString('\n')
				if e != nil || l == ".\r\n" {
					break
				}
				b.WriteString(l)
			}
			f.mu.Lock()
			f.data = b.String()
			f.mu.Unlock()
			say("250 queued")
		case cmd == "QUIT":
			say("221 bye")
			return
		default:
			say("250 ok")
		}
	}
}

func TestEmailRequiresTLSAndCannotInjectHeaders(t *testing.T) {
	f, pool := newFakeSMTP(t, true)
	host, port, _ := net.SplitHostPort(f.addr)
	d := &delivery{tls: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}}
	m := emailTarget{Host: host, Username: "bot", Password: "pw", From: "panel@example.com", To: []string{"ops@example.com"}}
	m.Port = mustPort(t, port)
	if e := d.mail(context.Background(), m, "Hi\r\nBcc: attacker@example.com", "line one\n.\nend\n"); e != nil {
		t.Fatal(e)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.tlsSeen || !strings.Contains(f.authed, "bot\x00pw") {
		t.Fatal("authenticated without TLS", f.tlsSeen)
	}
	if strings.Contains(f.data, "\r\nBcc:") || !strings.Contains(f.data, "Subject: Hi Bcc: attacker@example.com") || !strings.Contains(f.data, "\r\n..\r\n") {
		t.Fatal(f.data)
	}

	plain, _ := newFakeSMTP(t, false)
	host, port, _ = net.SplitHostPort(plain.addr)
	m.Host, m.Port = host, mustPort(t, port)
	if e := d.mail(context.Background(), m, "s", "b"); e == nil || !strings.Contains(e.Error(), "STARTTLS") {
		t.Fatal("sent without TLS", e)
	}
	plain.mu.Lock()
	defer plain.mu.Unlock()
	if plain.authed != "" {
		t.Fatal("password sent in clear text")
	}
}

func mustPort(t *testing.T, p string) int {
	t.Helper()
	n, e := strconv.Atoi(p)
	if e != nil {
		t.Fatal(e)
	}
	return n
}

func TestMailBodyDropsBareCarriageReturns(t *testing.T) {
	m := emailTarget{From: "panel@example.com", To: []string{"ops@example.com"}}
	got := string(buildMail(m, "s", "a\r.\rb\r\nc", time.Unix(0, 0)))
	body := got[strings.Index(got, "\r\n\r\n")+4:]
	if body != "a.b\r\nc\r\n" {
		t.Fatalf("%q", body)
	}
}
