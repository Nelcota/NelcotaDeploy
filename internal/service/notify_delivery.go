package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/smtp"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Notification is one message for people outside the panel.
type Notification struct {
	Event  string `json:"event"`
	Title  string `json:"title"`
	Detail string `json:"detail"`
	Link   string `json:"url,omitempty"`
	At     int64  `json:"at"`
}

// delivery sends notifications to webhooks and email.
type delivery struct {
	origin string
	// client posts webhooks; nil uses a client that refuses private addresses.
	client *http.Client
	// tls configures SMTP TLS; nil uses the system roots. Tests override it.
	tls *tls.Config
	// retryDelay is the first wait between attempts; it doubles each time.
	retryDelay time.Duration
}

var errPrivateAddress = errors.New("refusing a private or local address")

// privateRanges are blocked for webhooks in addition to Go's IsPrivate and friends.
var privateRanges = func() []*net.IPNet {
	var out []*net.IPNet
	for _, c := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "198.18.0.0/15", "64:ff9b::/96"} {
		_, n, _ := net.ParseCIDR(c)
		out = append(out, n)
	}
	return out
}()

// publicIP reports whether ip is routable on the internet: not loopback,
// private, link-local (including cloud metadata), multicast, or reserved.
func publicIP(ip net.IP) bool {
	if ip4 := ip.To4(); ip4 != nil {
		ip = ip4
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsInterfaceLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	for _, n := range privateRanges {
		if n.Contains(ip) {
			return false
		}
	}
	return true
}

// publicDialer resolves the host itself and connects only to public
// addresses, so DNS can't redirect a webhook into the private network.
func publicDialer(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, e := net.SplitHostPort(addr)
	if e != nil {
		return nil, e
	}
	ips, e := net.DefaultResolver.LookupIPAddr(ctx, host)
	if e != nil {
		return nil, e
	}
	d := &net.Dialer{Timeout: 5 * time.Second}
	var last error = errPrivateAddress
	for _, ip := range ips {
		if !publicIP(ip.IP) {
			continue
		}
		c, e := d.DialContext(ctx, network, net.JoinHostPort(ip.IP.String(), port))
		if e == nil {
			return c, nil
		}
		last = e
	}
	return nil, last
}

func publicClient() *http.Client {
	return &http.Client{
		Timeout:       10 * time.Second,
		Transport:     &http.Transport{DialContext: publicDialer, TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 10 * time.Second, MaxIdleConns: 4, IdleConnTimeout: time.Minute, ForceAttemptHTTP2: true},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

func (d *delivery) httpClient() *http.Client {
	if d.client != nil {
		return d.client
	}
	return publicClient()
}

// webhookKind recognizes chat services that need their own message format.
func webhookKind(u *url.URL) string {
	if u == nil {
		return ""
	}
	host := strings.ToLower(u.Hostname())
	switch {
	case host == "hooks.slack.com":
		return "slack"
	case (host == "discord.com" || host == "discordapp.com" || strings.HasSuffix(host, ".discord.com")) && strings.HasPrefix(u.Path, "/api/webhooks/"):
		return "discord"
	}
	return "webhook"
}

// slackEscape keeps text from being read as Slack markup or mentions.
var slackEscape = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")

// webhookBody formats a notification for the target's service.
func webhookBody(kind string, n Notification) ([]byte, error) {
	switch kind {
	case "slack":
		text := "*" + slackEscape.Replace(n.Title) + "*\n" + slackEscape.Replace(n.Detail)
		if n.Link != "" {
			text += "\n<" + n.Link + "|Open in NelcotaDeploy>"
		}
		return json.Marshal(map[string]any{"text": text})
	case "discord":
		text := "**" + n.Title + "**\n" + n.Detail
		if n.Link != "" {
			text += "\n" + n.Link
		}
		// No mentions: commit messages and app names must not ping anyone.
		return json.Marshal(map[string]any{"content": truncate(text, 1900), "allowed_mentions": map[string]any{"parse": []string{}}})
	}
	return json.Marshal(n)
}

func (d *delivery) post(ctx context.Context, w webhookTarget, n Notification) error {
	u, e := url.Parse(w.URL)
	if e != nil {
		return errors.New("invalid webhook address")
	}
	kind := webhookKind(u)
	body, e := webhookBody(kind, n)
	if e != nil {
		return e
	}
	req, e := http.NewRequestWithContext(ctx, http.MethodPost, w.URL, bytes.NewReader(body))
	if e != nil {
		return errors.New("invalid webhook address")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "NelcotaDeploy")
	if kind == "webhook" {
		req.Header.Set("X-Nelcota-Event", n.Event)
		if w.Secret != "" {
			mac := hmac.New(sha256.New, []byte(w.Secret))
			mac.Write(body)
			req.Header.Set("X-Nelcota-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
		}
	}
	res, e := d.httpClient().Do(req)
	if e != nil {
		if errors.Is(e, errPrivateAddress) {
			return errors.New("the webhook address points to a private network")
		}
		return errors.New("the webhook couldn't be reached")
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("the webhook answered HTTP %d", res.StatusCode)
	}
	return nil
}

func messageID(host string) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return "<" + hex.EncodeToString(b) + "@" + host + ">"
}

// buildMail renders a plain-text UTF-8 message.
func buildMail(m emailTarget, subject, body string, now time.Time) []byte {
	var b bytes.Buffer
	domain := m.From[strings.LastIndex(m.From, "@")+1:]
	fmt.Fprintf(&b, "From: NelcotaDeploy <%s>\r\n", oneLine(m.From))
	fmt.Fprintf(&b, "To: %s\r\n", oneLine(strings.Join(m.To, ", ")))
	fmt.Fprintf(&b, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", oneLine(subject)))
	fmt.Fprintf(&b, "Date: %s\r\n", now.Format(time.RFC1123Z))
	fmt.Fprintf(&b, "Message-ID: %s\r\n", messageID(domain))
	b.WriteString("MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\nAuto-Submitted: auto-generated\r\n\r\n")
	for line := range strings.Lines(body) {
		// Dot-stuffing is done by net/smtp. Bare carriage returns are dropped so
		// a value can't fake an SMTP line ending.
		line = strings.ReplaceAll(strings.TrimRight(line, "\r\n"), "\r", "")
		b.WriteString(line + "\r\n")
	}
	return b.Bytes()
}

func (d *delivery) tlsConfig(host string) *tls.Config {
	if d.tls != nil {
		c := d.tls.Clone()
		c.ServerName = host
		return c
	}
	return &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}
}

// mail sends over TLS only: implicit TLS on 465, STARTTLS otherwise. A server
// without STARTTLS is refused rather than sent the password in clear text.
func (d *delivery) mail(ctx context.Context, m emailTarget, subject, body string) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	addr := net.JoinHostPort(m.Host, strconv.Itoa(m.Port))
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	var conn net.Conn
	var e error
	if m.Port == 465 {
		conn, e = (&tls.Dialer{NetDialer: dialer, Config: d.tlsConfig(m.Host)}).DialContext(ctx, "tcp", addr)
	} else {
		conn, e = dialer.DialContext(ctx, "tcp", addr)
	}
	if e != nil {
		return errors.New("the mail server couldn't be reached")
	}
	deadline, _ := ctx.Deadline()
	_ = conn.SetDeadline(deadline)
	c, e := smtp.NewClient(conn, m.Host)
	if e != nil {
		_ = conn.Close()
		return errors.New("the mail server didn't answer as SMTP")
	}
	defer func() { _ = c.Close() }()
	if m.Port != 465 {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return errors.New("the mail server doesn't offer STARTTLS")
		}
		if e := c.StartTLS(d.tlsConfig(m.Host)); e != nil {
			return errors.New("the mail server's TLS certificate wasn't accepted")
		}
	}
	if m.Username != "" {
		if e := c.Auth(smtp.PlainAuth("", m.Username, m.Password, m.Host)); e != nil {
			return errors.New("the mail server rejected the username or password")
		}
	}
	if e := c.Mail(m.From); e != nil {
		return errors.New("the mail server rejected the sender")
	}
	for _, to := range m.To {
		if e := c.Rcpt(to); e != nil {
			return errors.New("the mail server rejected a recipient")
		}
	}
	w, e := c.Data()
	if e != nil {
		return errors.New("the mail server refused the message")
	}
	if _, e := w.Write(buildMail(m, subject, body, time.Now())); e != nil {
		return errors.New("the message couldn't be sent")
	}
	if e := w.Close(); e != nil {
		return errors.New("the mail server refused the message")
	}
	return c.Quit()
}

// deliver sends n to every channel, retrying each up to attempts times with
// exponential backoff, and describes each channel that failed.
func (d *delivery) deliver(ctx context.Context, cfg notifyConfig, n Notification, attempts int) []string {
	if n.At == 0 {
		n.At = time.Now().Unix()
	}
	var failed []string
	if cfg.Webhook != nil {
		if e := d.retry(ctx, attempts, func(ctx context.Context) error { return d.post(ctx, *cfg.Webhook, n) }); e != nil {
			failed = append(failed, "Webhook: "+e.Error()+".")
		}
	}
	if cfg.Email != nil {
		body := n.Detail
		if n.Link != "" {
			body += "\n\n" + n.Link
		}
		if e := d.retry(ctx, attempts, func(ctx context.Context) error { return d.mail(ctx, *cfg.Email, n.Title, body+"\n") }); e != nil {
			failed = append(failed, "Email: "+e.Error()+".")
		}
	}
	return failed
}

func (d *delivery) retry(ctx context.Context, attempts int, send func(context.Context) error) error {
	wait := d.retryDelay
	if wait == 0 {
		wait = 2 * time.Second
	}
	var e error
	for i := range attempts {
		if e = send(ctx); e == nil {
			return nil
		}
		if i == attempts-1 {
			break
		}
		select {
		case <-ctx.Done():
			return e
		case <-time.After(wait):
		}
		wait *= 2
	}
	return e
}
