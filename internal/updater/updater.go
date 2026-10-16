package updater

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/host"
)

var Version = "v0.0.0-dev"
var requestIDRE = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

const sysNoFollow = syscall.O_NOFOLLOW | syscall.O_NONBLOCK

var versionRE = regexp.MustCompile(`^v(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$`)

func ValidVersion(v string) bool { return versionRE.MatchString(v) }
func Newer(candidate, current string) bool {
	if !ValidVersion(candidate) {
		return false
	}
	if current == "v0.0.0-dev" {
		return true
	}
	if !ValidVersion(current) {
		return false
	}
	a, b := strings.Split(candidate[1:], "."), strings.Split(current[1:], ".")
	for i := range a {
		x, _ := strconv.Atoi(a[i])
		y, _ := strconv.Atoi(b[i])
		if x != y {
			return x > y
		}
	}
	return false
}

type Trust struct {
	BaseURL   string       `json:"base_url"`
	PublicKey string       `json:"public_key"`
	Target    string       `json:"target"`
	Client    *http.Client `json:"-"`
	HealthURL string       `json:"health_url,omitempty"`
}

func LoadTrust(p string) (Trust, error) {
	f, e := os.OpenFile(p, os.O_RDONLY|sysNoFollow, 0)
	if e != nil {
		return Trust{}, e
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil {
		return Trust{}, e
	}
	if !st.Mode().IsRegular() || st.Mode().Perm()&0022 != 0 || st.Size() > 16<<10 {
		return Trust{}, errors.New("release trust must be a protected regular file")
	}
	b, e := io.ReadAll(io.LimitReader(f, (16<<10)+1))
	if e != nil {
		return Trust{}, e
	}
	if len(b) > 16<<10 {
		return Trust{}, errors.New("release trust file too large")
	}
	var t Trust
	if e = json.Unmarshal(b, &t); e != nil {
		return t, errors.New("invalid update trust configuration")
	}
	return t, t.validate()
}
func (t Trust) validate() error {
	u, e := url.Parse(t.BaseURL)
	if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.Contains(u.Path, "..") || t.PublicKey == "" {
		return errors.New("invalid update trust configuration")
	}
	if t.Target != "amd64_v1" && t.Target != "amd64_v3" && t.Target != "arm64" {
		return errors.New("invalid update target")
	}
	if t.HealthURL != "" {
		health, e := url.Parse(t.HealthURL)
		if e != nil || health.Scheme != "http" || health.User != nil || health.RawQuery != "" || health.Fragment != "" || health.Path != "/healthz" {
			return errors.New("update health URL must be a loopback HTTP healthz endpoint")
		}
		ip := net.ParseIP(health.Hostname())
		port, e := strconv.Atoi(health.Port())
		if ip == nil || !ip.IsLoopback() || e != nil || port < 1 || port > 65535 {
			return errors.New("update health URL must be a loopback HTTP healthz endpoint")
		}
	}
	return nil
}
func TrustPath(component string) string { return "/etc/nelcota-release-" + component + ".json" }
func RequestPath(data string) string    { return filepath.Join(data, "update", "request.json") }
func (t Trust) Check(ctx context.Context, version string) error {
	_, _, e := t.manifest(ctx, version)
	return e
}
func (t Trust) manifest(ctx context.Context, version string) (map[string]string, []byte, error) {
	if e := t.validate(); e != nil {
		return nil, nil, e
	}
	if !ValidVersion(version) {
		return nil, nil, errors.New("invalid release version")
	}
	checks, e := t.fetch(ctx, version, "checksums.txt", 64<<10)
	if e != nil {
		return nil, nil, e
	}
	sig, e := t.fetch(ctx, version, "checksums.txt.minisig", 4<<10)
	if e != nil {
		return nil, nil, e
	}
	if e = VerifyMinisign(checks, sig, t.PublicKey); e != nil {
		return nil, nil, e
	}
	hashes := map[string]string{}
	for _, line := range strings.Split(strings.TrimSpace(string(checks)), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 || len(fields[0]) != 64 || filepath.Base(fields[1]) != fields[1] || strings.ContainsAny(fields[1], "\\\x00") || hashes[fields[1]] != "" {
			return nil, nil, errors.New("invalid release checksums")
		}
		if _, e = hex.DecodeString(fields[0]); e != nil {
			return nil, nil, e
		}
		hashes[fields[1]] = strings.ToLower(fields[0])
	}
	meta, e := t.fetch(ctx, version, "release.json", 4096)
	if e != nil {
		return nil, nil, e
	}
	sum := sha256.Sum256(meta)
	if hashes["release.json"] != hex.EncodeToString(sum[:]) {
		return nil, nil, errors.New("release metadata checksum mismatch")
	}
	var release struct {
		Version  string `json:"version"`
		Protocol int    `json:"protocol"`
	}
	if e = json.Unmarshal(meta, &release); e != nil || release.Version != version || release.Protocol != 1 {
		return nil, nil, errors.New("incompatible release metadata")
	}
	return hashes, meta, nil
}

// Latest returns the newest stable version the release location announces in
// its "latest" file. The pointer is not signed: callers must verify the
// version with Check before offering or applying it.
func (t Trust) Latest(ctx context.Context) (string, error) {
	if e := t.validate(); e != nil {
		return "", e
	}
	req, e := http.NewRequestWithContext(ctx, "GET", strings.TrimRight(t.BaseURL, "/")+"/latest", nil)
	if e != nil {
		return "", errors.New("invalid release request")
	}
	res, e := t.client().Do(req)
	if e != nil {
		return "", errors.New("release check failed")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return "", errors.New("release check rejected")
	}
	b, e := io.ReadAll(io.LimitReader(res.Body, 65))
	version := strings.TrimSpace(string(b))
	if e != nil || len(b) > 64 || !ValidVersion(version) {
		return "", errors.New("invalid latest version")
	}
	return version, nil
}

func (t Trust) client() *http.Client {
	c := t.Client
	if c == nil {
		c = &http.Client{Timeout: 5 * time.Minute}
	}
	clone := *c
	clone.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &clone
}
func (t Trust) request(ctx context.Context, version, name string) (*http.Response, error) {
	req, e := http.NewRequestWithContext(ctx, "GET", strings.TrimRight(t.BaseURL, "/")+"/"+version+"/"+name, nil)
	if e != nil {
		return nil, errors.New("invalid release request")
	}
	res, e := t.client().Do(req)
	if e != nil {
		return nil, errors.New("release download failed")
	}
	if res.StatusCode != 200 {
		_ = res.Body.Close()
		return nil, errors.New("release download rejected")
	}
	return res, nil
}
func (t Trust) fetch(ctx context.Context, version, name string, max int64) ([]byte, error) {
	r, e := t.request(ctx, version, name)
	if e != nil {
		return nil, e
	}
	defer r.Body.Close()
	b, e := io.ReadAll(io.LimitReader(r.Body, max+1))
	if e != nil || int64(len(b)) > max {
		return nil, errors.New("release file too large or incomplete")
	}
	return b, nil
}

type Request struct {
	Version string `json:"version"`
	ID      string `json:"id"`
}
type Result struct {
	Version string `json:"version"`
	ID      string `json:"id"`
	Status  string `json:"status"`
	At      int64  `json:"at"`
}

func Queue(data string, r Request) error { return queueFile(RequestPath(data), data, r) }

// Apply is called by a fixed root-owned systemd helper. Revalidation and downloads
// happen here, never trusting a service-writable staged executable.
func (t Trust) Apply(ctx context.Context, data, state, destination, component string, restart func(context.Context, string) error) (err error) {
	if component != "panel" && component != "agent" {
		return errors.New("invalid update component")
	}
	if e := os.MkdirAll(state, 0700); e != nil {
		return e
	}
	lock, e := host.LockFile(filepath.Join(state, "update.lock"))
	if e != nil {
		return e
	}
	defer lock.Close()
	r, e := readDataRequest(data, "update/request.json")
	if e != nil {
		return e
	}
	result := Result{Version: r.Version, ID: r.ID, Status: "failed", At: time.Now().Unix()}
	defer func() {
		_ = writeResult(data, result)
		removeRequest(data, "update/request.json")
	}()
	current := Version
	var savedVersion []byte
	if b, e := os.ReadFile(filepath.Join(state, "version")); e == nil {
		savedVersion = b
		saved := strings.TrimSpace(string(b))
		if !ValidVersion(saved) {
			return errors.New("invalid installed release state")
		}
		if Newer(saved, current) {
			current = saved
		}
	} else if !os.IsNotExist(e) {
		return errors.New("installed release state unavailable")
	}
	if !Newer(r.Version, current) {
		return errors.New("update must be newer than installed release")
	}
	hashes, _, e := t.manifest(ctx, r.Version)
	if e != nil {
		return e
	}
	name := "nelcota-" + component + "_linux_" + t.Target
	expected := hashes[name]
	if expected == "" {
		return errors.New("release binary missing")
	}
	if runtime.GOARCH == "arm64" && t.Target != "arm64" || runtime.GOARCH == "amd64" && t.Target == "arm64" {
		return errors.New("release architecture mismatch")
	}
	res, e := t.request(ctx, r.Version, name)
	if e != nil {
		return e
	}
	defer res.Body.Close()
	out, e := os.CreateTemp(filepath.Dir(destination), ".nelcota-update-")
	if e != nil {
		return e
	}
	defer func() { _ = out.Close(); _ = os.Remove(out.Name()) }()
	h := sha256.New()
	n, e := io.Copy(io.MultiWriter(out, h), io.LimitReader(res.Body, (128<<20)+1))
	if e != nil || n > 128<<20 || n == 0 || hex.EncodeToString(h.Sum(nil)) != expected {
		return errors.New("release binary checksum mismatch")
	}
	if e = out.Chmod(0755); e != nil {
		return e
	}
	if e = out.Sync(); e != nil {
		return e
	}
	if e = out.Close(); e != nil {
		return e
	}
	// Fail closed on non-regular destinations, including symlinks.
	st, e := os.Lstat(destination)
	if e != nil || !st.Mode().IsRegular() {
		return errors.New("invalid installed binary")
	}
	previous := destination + ".previous"
	if e = os.Remove(previous); e != nil && !os.IsNotExist(e) {
		return e
	}
	if e = os.Link(destination, previous); e != nil {
		return e
	}
	if e = os.Rename(out.Name(), destination); e != nil {
		return e
	}
	rollback := func(restoreState bool) error {
		removeRequest(data, "update/request.json")
		rollback, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		if re := os.Rename(previous, destination); re != nil {
			return errors.New("update failed; binary rollback requires repair")
		}
		_ = syncDirectory(filepath.Dir(destination))
		if re := restart(rollback, current); re != nil {
			return errors.New("update failed; previous binary restored but service requires repair")
		}
		result.Status = "rolled_back"
		if restoreState {
			var re error
			if savedVersion != nil {
				re = atomicFile(filepath.Join(state, "version"), savedVersion, 0600)
			} else if st, e := os.Lstat(filepath.Join(state, "version")); e == nil {
				if st.Mode().IsRegular() {
					re = os.Remove(filepath.Join(state, "version"))
					if re == nil {
						re = syncDirectory(state)
					}
				} else {
					re = errors.New("invalid release state")
				}
			} else if !os.IsNotExist(e) {
				re = e
			}
			if re != nil {
				return errors.New("previous binary restored; release state requires repair")
			}
		}
		return errors.New("update failed; previous binary restored")
	}
	if e = syncDirectory(filepath.Dir(destination)); e != nil {
		return rollback(false)
	}
	// Bind readiness to the validated release, never to the mutable request file.
	if e = restart(ctx, r.Version); e != nil {
		return rollback(false)
	}
	if e = atomicFile(filepath.Join(state, "version"), []byte(r.Version+"\n"), 0600); e != nil {
		return rollback(true)
	}
	result.Status = "applied"
	return nil
}
func atomicFile(path string, b []byte, mode os.FileMode) error {
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(path), ".write-")
	if e != nil {
		return e
	}
	defer func() { _ = f.Close(); _ = os.Remove(f.Name()) }()
	if _, e = f.Write(b); e != nil {
		return e
	}
	if e = f.Chmod(mode); e != nil {
		return e
	}
	if e = f.Sync(); e != nil {
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	if e = os.Rename(f.Name(), path); e != nil {
		return e
	}
	return syncDirectory(filepath.Dir(path))
}
func syncDirectory(path string) error {
	f, e := os.Open(path)
	if e != nil {
		return e
	}
	defer f.Close()
	return f.Sync()
}

func ReadResult(data string) Result {
	root, e := os.OpenRoot(data)
	if e != nil {
		return Result{}
	}
	defer root.Close()
	f, e := root.OpenFile("update/result.json", os.O_RDONLY|sysNoFollow, 0)
	if e != nil {
		return Result{}
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, 4097))
	if e != nil || len(b) > 4096 {
		return Result{}
	}
	var r Result
	if json.Unmarshal(b, &r) != nil {
		return Result{}
	}
	return r
}

func Pending(data string) bool { _, e := os.Stat(RequestPath(data)); return e == nil }
