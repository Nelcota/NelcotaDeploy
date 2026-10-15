package updater

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"golang.org/x/crypto/blake2b"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func signedFixture(t *testing.T) (Trust, map[string][]byte) {
	t.Helper()
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	id := []byte("key-id01")
	pk := append(append([]byte("Ed"), id...), pub...)
	files := map[string][]byte{"release.json": []byte(`{"version":"v1.2.3","protocol":1}`), "nelcota-panel_linux_amd64_v1": []byte("new signed binary")}
	var checks strings.Builder
	for _, name := range []string{"release.json", "nelcota-panel_linux_amd64_v1"} {
		sum := sha256.Sum256(files[name])
		fmt.Fprintf(&checks, "%s  %s\n", hex.EncodeToString(sum[:]), name)
	}
	files["checksums.txt"] = []byte(checks.String())
	digest := blake2b.Sum512(files["checksums.txt"])
	signature := ed25519.Sign(key, digest[:])
	comment := "timestamp:1 file:checksums.txt"
	global := ed25519.Sign(key, append(append([]byte{}, signature...), []byte(comment)...))
	sig := append(append([]byte("ED"), id...), signature...)
	files["checksums.txt.minisig"] = fmt.Appendf(nil, "untrusted comment: signature from minisign secret key\n%s\ntrusted comment: %s\n%s\n", base64.StdEncoding.EncodeToString(sig), comment, base64.StdEncoding.EncodeToString(global))
	return Trust{PublicKey: base64.StdEncoding.EncodeToString(pk), Target: "amd64_v1"}, files
}
func TestMinisignAuthenticatesContentAndTrustedComment(t *testing.T) {
	trust, files := signedFixture(t)
	message, sig := files["checksums.txt"], files["checksums.txt.minisig"]
	if e := VerifyMinisign(message, sig, trust.PublicKey); e != nil {
		t.Fatal(e)
	}
	for _, bad := range [][]byte{[]byte(strings.Replace(string(sig), "timestamp:1", "timestamp:2", 1)), sig[:len(sig)-5], []byte(strings.Replace(string(sig), "trusted comment: ", "invalid comment: ", 1))} {
		if e := VerifyMinisign(message, bad, trust.PublicKey); e == nil {
			t.Fatal("accepted invalid signature")
		}
	}
	if e := VerifyMinisign(append(message, 'x'), sig, trust.PublicKey); e == nil {
		t.Fatal("accepted modified content")
	}
	other, _ := signedFixture(t)
	if e := VerifyMinisign(message, sig, other.PublicKey); e == nil {
		t.Fatal("accepted another key")
	}
}
func TestApplyIsAtomicRejectsTamperingAndRollsBack(t *testing.T) {
	for _, mode := range []string{"success", "tampered", "restart_failure", "downgrade", "cancelled", "request_changed", "state_failure", "state_unreadable"} {
		t.Run(mode, func(t *testing.T) {
			trust, files := signedFixture(t)
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				name := strings.TrimPrefix(r.URL.Path, "/v1.2.3/")
				b, ok := files[name]
				if !ok {
					http.NotFound(w, r)
					return
				}
				_, _ = w.Write(b)
			}))
			defer server.Close()
			trust.BaseURL = server.URL
			trust.Client = server.Client()
			root := t.TempDir()
			data, state, bin := filepath.Join(root, "data"), filepath.Join(root, "state"), filepath.Join(root, "panel")
			_ = os.MkdirAll(data, 0700)
			_ = os.MkdirAll(state, 0700)
			_ = os.WriteFile(bin, []byte("old binary"), 0755)
			if e := Queue(data, Request{Version: "v1.2.3", ID: "update-1"}); e != nil {
				t.Fatal(e)
			}
			if e := Queue(data, Request{Version: "v1.2.3", ID: "update-2"}); e == nil {
				t.Fatal("overwrote pending update")
			}
			if mode == "tampered" {
				files["nelcota-panel_linux_amd64_v1"] = []byte("tampered")
			}
			if mode == "downgrade" {
				_ = os.WriteFile(filepath.Join(state, "version"), []byte("v2.0.0"), 0600)
			}
			if mode == "state_unreadable" {
				_ = os.Mkdir(filepath.Join(state, "version"), 0700)
			}
			calls := 0
			restart := func(_ context.Context, expected string) error {
				calls++
				want := "v1.2.3"
				if calls == 2 {
					want = Version
				}
				if expected != want {
					t.Fatalf("readiness expected %q, want validated %q", expected, want)
				}
				if mode == "request_changed" {
					removeRequest(data, "update/request.json")
					if e := Queue(data, Request{Version: "v9.9.9", ID: "replaced"}); e != nil {
						t.Fatal(e)
					}
				}
				if mode == "state_failure" && calls == 1 {
					_ = os.Mkdir(filepath.Join(state, "version"), 0700)
				}
				if mode == "restart_failure" && calls == 1 {
					return errors.New("startup failed")
				}
				return nil
			}
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			if mode == "cancelled" {
				cancel()
			}
			e := trust.Apply(ctx, data, state, bin, "panel", restart)
			got, _ := os.ReadFile(bin)
			resultBytes, _ := os.ReadFile(filepath.Join(data, "update", "result.json"))
			var result Result
			_ = json.Unmarshal(resultBytes, &result)
			if mode == "success" || mode == "request_changed" {
				if e != nil || string(got) != "new signed binary" || calls != 1 || result.Status != "applied" {
					t.Fatal(e, string(got), calls, result)
				}
			} else {
				if e == nil || string(got) != "old binary" {
					t.Fatal("modified binary on failed update", e, string(got))
				}
				if (mode == "restart_failure" || mode == "state_failure") && (calls != 2 || result.Status != "rolled_back") {
					t.Fatal(calls, result)
				}
			}
		})
	}
}
func TestVersionAndUninstallBoundaries(t *testing.T) {
	for _, v := range []string{"../v1.2.3", "v01.2.3", "1.2.3", "v1.2.3;id", "v1.2.3-rc1"} {
		if ValidVersion(v) {
			t.Fatal(v)
		}
	}
	if Newer("v1.2.3", "v1.2.3") || Newer("v1.2.3", "v2.0.0") || !Newer("v1.10.0", "v1.9.0") {
		t.Fatal("version ordering")
	}
	root := t.TempDir()
	for _, p := range []string{"var/lib/nelcota/state", "etc/nelcota/master.key", "usr/local/bin/nelcota-panel", "etc/systemd/system/nelcota-panel.service", "etc/unrelated"} {
		_ = os.MkdirAll(filepath.Dir(filepath.Join(root, p)), 0700)
		_ = os.WriteFile(filepath.Join(root, p), []byte("keep"), 0600)
	}
	systemctl := func(context.Context, ...string) error { return nil }
	if e := Uninstall(t.Context(), root, "panel", false, systemctl); e != nil {
		t.Fatal(e)
	}
	if _, e := os.Stat(filepath.Join(root, "var/lib/nelcota/state")); e != nil {
		t.Fatal("deleted data by default")
	}
	if e := Uninstall(t.Context(), root, "panel", true, systemctl); e != nil {
		t.Fatal(e)
	}
	if _, e := os.Stat(filepath.Join(root, "var/lib/nelcota")); !os.IsNotExist(e) {
		t.Fatal("purge failed")
	}
	if _, e := os.Stat(filepath.Join(root, "etc/unrelated")); e != nil {
		t.Fatal("removed unrelated file")
	}
}

func TestRequestsAndHelperResultsStayInsideData(t *testing.T) {
	data, outside := t.TempDir(), t.TempDir()
	if e := os.Symlink(outside, filepath.Join(data, "update")); e != nil {
		t.Fatal(e)
	}
	if e := Queue(data, Request{ID: "u", Version: "v1.0.0"}); e == nil {
		t.Fatal("queued outside data root")
	}
	if e := writeResult(data, Result{ID: "u", Status: "failed"}); e == nil {
		t.Fatal("wrote privileged result outside data root")
	}
	entries, _ := os.ReadDir(outside)
	if len(entries) != 0 {
		t.Fatal(entries)
	}
	if e := RequestUpgrade(data, Request{ID: "cli", Version: "v1.0.0"}); e != nil {
		t.Fatal(e)
	}
	r, e := readDataRequest(data, "admin-update.json")
	if e != nil || r.ID != "cli" {
		t.Fatal(r, e)
	}
}

func TestAgentHealthAndPendingRequestVersions(t *testing.T) {
	data := t.TempDir()
	if e := WriteHealth(data, "v1.2.3", true); e != nil {
		t.Fatal(e)
	}
	if !healthyAgent(data, "v1.2.3", os.Getpid()) || healthyAgent(data, "v1.2.4", os.Getpid()) || healthyAgent(data, "v1.2.3", os.Getpid()+1) {
		t.Fatal("agent readiness identity check")
	}
	if e := Queue(data, Request{ID: "request", Version: "v1.2.3"}); e != nil {
		t.Fatal(e)
	}
	if !PendingFor(data, "v1.2.2") || PendingFor(data, "v1.2.3") {
		t.Fatal("candidate cannot become ready during helper verification")
	}
	removeRequest(data, "update/request.json")
	if PendingFor(data, "v1.2.2") {
		t.Fatal("rollback remained blocked")
	}
}

func TestTrustAndHealthEndpointAreBoundedAndLocal(t *testing.T) {
	trust, _ := signedFixture(t)
	trust.BaseURL = "https://releases.example.com"
	for _, endpoint := range []string{"http://127.0.0.1:9090/healthz", "http://[::1]:8080/healthz"} {
		trust.HealthURL = endpoint
		if e := trust.validate(); e != nil {
			t.Fatal(endpoint, e)
		}
	}
	for _, endpoint := range []string{"https://127.0.0.1:8080/healthz", "http://example.com:8080/healthz", "http://10.77.0.1:8080/healthz", "http://127.0.0.1:8080/healthz?token=secret", "http://127.0.0.1:8080/other", "http://127.0.0.1:99999/healthz", "http://user@127.0.0.1:8080/healthz"} {
		trust.HealthURL = endpoint
		if e := trust.validate(); e == nil {
			t.Fatal("accepted unsafe health URL", endpoint)
		}
	}
	trust.HealthURL = ""
	path := filepath.Join(t.TempDir(), "trust.json")
	b, _ := json.Marshal(trust)
	if e := os.WriteFile(path, b, 0644); e != nil {
		t.Fatal(e)
	}
	if _, e := LoadTrust(path); e != nil {
		t.Fatal(e)
	}
	link := filepath.Join(t.TempDir(), "link")
	_ = os.Symlink(path, link)
	if _, e := LoadTrust(link); e == nil {
		t.Fatal("followed a trust symlink")
	}
	_ = os.Truncate(path, (16<<10)+1)
	if _, e := LoadTrust(path); e == nil {
		t.Fatal("accepted an oversized trust file")
	}
	_ = os.Remove(path)
	if e := syscall.Mkfifo(path, 0600); e != nil {
		t.Fatal(e)
	}
	if _, e := LoadTrust(path); e == nil {
		t.Fatal("accepted a trust FIFO")
	}
}
