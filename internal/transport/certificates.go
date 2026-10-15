package transport

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/nelcota/nelcota-deploy/internal/security"
	"github.com/nelcota/nelcota-deploy/internal/updater"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const CertificatePath = "/internal/certificate/renew"

func tlsPeer(r *http.Request) (Peer, error) {
	if r.TLS == nil || len(r.TLS.VerifiedChains) == 0 || len(r.TLS.PeerCertificates) == 0 {
		return Peer{}, errors.New("mTLS required")
	}
	c := r.TLS.PeerCertificates[0]
	id := ""
	for _, u := range c.URIs {
		if u.Scheme == "spiffe" && u.Host == "nelcota" && strings.HasPrefix(u.Path, "/agents/") {
			id = strings.TrimPrefix(u.Path, "/agents/")
		}
	}
	if id == "" {
		return Peer{}, errors.New("invalid agent identity")
	}
	sum := sha256.Sum256(c.Raw)
	return Peer{ID: id, Fingerprint: hex.EncodeToString(sum[:])}, nil
}
func CertificateHandler(renew func(context.Context, Peer) (security.CertificateBundle, error)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != "POST" {
			w.WriteHeader(405)
			return
		}
		peer, e := tlsPeer(r)
		if e != nil {
			http.Error(w, "mTLS required", 401)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		bundle, e := renew(ctx, peer)
		if e != nil {
			http.Error(w, "certificate renewal unavailable", 403)
			return
		}
		if bundle.Certificate == "" {
			w.WriteHeader(204)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(bundle)
	})
}

// RenewCertificate uses a separate short HTTP request; it never cancels the
// deployment stream. New TLS handshakes use the atomic current certificate.
func RenewCertificate(ctx context.Context, base string, config *tls.Config, manager *security.Certificates) error {
	u, e := url.Parse(base)
	if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("invalid control URL")
	}
	u.Path = CertificatePath
	u.RawPath = ""
	tr := &http.Transport{TLSClientConfig: config, ForceAttemptHTTP2: true}
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	req, e := http.NewRequestWithContext(ctx, "POST", u.String(), nil)
	if e != nil {
		return e
	}
	res, e := client.Do(req)
	if e != nil {
		return errors.New("certificate renewal failed")
	}
	defer res.Body.Close()
	if res.StatusCode == 204 {
		return nil
	}
	if res.StatusCode != 200 {
		return errors.New("certificate renewal rejected")
	}
	b, e := io.ReadAll(io.LimitReader(res.Body, (32<<10)+1))
	if e != nil || len(b) > 32<<10 {
		return errors.New("invalid renewal response")
	}
	var bundle security.CertificateBundle
	if json.Unmarshal(b, &bundle) != nil {
		return errors.New("invalid renewal response")
	}
	return manager.Update(bundle)
}
func RunCertificateRenewal(ctx context.Context, base string, config *tls.Config, manager *security.Certificates, report func(error)) error {
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		if manager.Due(time.Now()) {
			if e := RenewCertificate(ctx, base, config, manager); e != nil && ctx.Err() == nil {
				report(e)
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
		}
	}
}

const AgentUpdatePath = "/internal/update/prepare"

var ErrAgentRejected = errors.New("agent maintenance rejected")
var ErrAgentBusy = errors.New("agent maintenance is busy")

func AgentUpdateHandler(prepare func(context.Context, Peer, updater.Request) error) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != "POST" {
			w.WriteHeader(405)
			return
		}
		peer, e := tlsPeer(r)
		if e != nil {
			w.WriteHeader(401)
			return
		}
		var request updater.Request
		decoder := json.NewDecoder(io.LimitReader(r.Body, 4097))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&request) != nil || !updater.ValidRequest(request) {
			w.WriteHeader(400)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		if e = prepare(ctx, peer, request); e != nil {
			if errors.Is(e, ErrAgentBusy) {
				w.WriteHeader(409)
			} else {
				w.WriteHeader(403)
			}
			return
		}
		w.WriteHeader(204)
	})
}
func PrepareAgentUpdate(ctx context.Context, base string, config *tls.Config, r updater.Request) error {
	if !updater.ValidRequest(r) {
		return errors.New("invalid update request")
	}
	u, e := url.Parse(base)
	if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("invalid control URL")
	}
	b, _ := json.Marshal(r)
	tr := &http.Transport{TLSClientConfig: config, ForceAttemptHTTP2: true}
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	request, e := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(base, "/")+AgentUpdatePath, bytes.NewReader(b))
	if e != nil {
		return errors.New("invalid control request")
	}
	request.Header.Set("Content-Type", "application/json")
	res, e := client.Do(request)
	if e != nil {
		return errors.New("agent maintenance request failed")
	}
	defer res.Body.Close()
	if res.StatusCode == 409 {
		return ErrAgentBusy
	}
	if res.StatusCode == 400 || res.StatusCode == 403 {
		return ErrAgentRejected
	}
	if res.StatusCode != 204 {
		return errors.New("agent maintenance request unavailable")
	}
	return nil
}
