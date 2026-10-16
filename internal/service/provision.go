package service

import (
	"bufio"
	"context"
	"database/sql"
	"errors"
	"io"
	"net"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/events"
	"github.com/Nelcota/NelcotaDeploy/internal/security"
	"github.com/Nelcota/NelcotaDeploy/internal/updater"
	"golang.org/x/crypto/ssh"
)

// Release is where agents download signed releases from. Empty fields mean
// the panel has no release identity, and the install script keeps
// placeholders for people to fill in.
type Release struct {
	// URL is the per-version release location, for example
	// https://releases.example.com/v1.4.2.
	URL        string
	SigningKey string
}

var (
	tokenPattern      = regexp.MustCompile(`^[A-Za-z0-9_-]{20,128}$`)
	signingKeyPattern = regexp.MustCompile(`^[A-Za-z0-9+/=]{20,200}$`)
	sshUserPattern    = regexp.MustCompile(`^[a-z_][a-z0-9_-]{0,31}$`)
	sshHostPattern    = regexp.MustCompile(`^[A-Za-z0-9.:-]{1,253}$`)
)

// ReleaseFor builds the agent release location from the panel's trust and
// version; it is empty for development builds.
func ReleaseFor(baseURL, version, signingKey string) Release {
	if !updater.ValidVersion(version) || baseURL == "" || !signingKeyPattern.MatchString(signingKey) {
		return Release{}
	}
	return Release{URL: strings.TrimRight(baseURL, "/") + "/" + version, SigningKey: signingKey}
}

// InstallScript is the shell script that joins a new server. Every value it
// embeds is validated to a safe character set, so none can break out of its
// quotes; the origin comes from the panel's own configuration.
func InstallScript(origin, token string, r Release) string {
	release, key := "RELEASE_URL/vX.Y.Z", "MINISIGN_PUBLIC_KEY"
	if r.URL != "" && signingKeyPattern.MatchString(r.SigningKey) {
		release, key = r.URL, r.SigningKey
	}
	if !tokenPattern.MatchString(token) {
		token = "INVALID_TOKEN"
	}
	return strings.Join([]string{
		"install -m 0600 /dev/null /root/nelcota-join",
		"printf '%s\\n' '" + token + "' > /root/nelcota-join",
		"curl --proto '=https' --tlsv1.2 -fsSL " + origin + "/agent.sh -o /root/nelcota-agent-install.sh",
		"bash /root/nelcota-agent-install.sh --panel-url " + origin + " --join-file /root/nelcota-join \\",
		"  --release-url " + release + " --signing-key '" + key + "'",
		"rm /root/nelcota-join",
	}, "\n")
}

// SSHTarget is a server reachable over SSH.
type SSHTarget struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}

func (t SSHTarget) validate() error {
	if !sshHostPattern.MatchString(t.Host) || strings.HasPrefix(t.Host, "-") {
		return fail(Validation, "Enter the server's address")
	}
	if t.Port < 1 || t.Port > 65535 {
		return fail(Validation, "Enter a port between 1 and 65535")
	}
	return nil
}

func (t SSHTarget) addr() string { return net.JoinHostPort(t.Host, strconv.Itoa(t.Port)) }

// SSHInstall runs the install script on a server over SSH. The private key is
// used for this connection only and is never stored.
type SSHInstall struct {
	SSHTarget
	ServerID   string `json:"server_id"`
	Token      string `json:"token"`
	User       string `json:"user"`
	PrivateKey string `json:"private_key"`
	Passphrase string `json:"passphrase"`
	// Fingerprint is the host key the person confirmed (SHA256:…).
	Fingerprint string `json:"fingerprint"`
}

// ProvisionJob is an installation in progress or finished.
type ProvisionJob struct {
	ID       string   `json:"id"`
	ServerID string   `json:"server_id"`
	Status   string   `json:"status"` // running, done, failed
	Lines    []string `json:"lines"`
	Error    string   `json:"error,omitempty"`
}

// Provisioning installs agents on new servers.
type Provisioning interface {
	Script(token string) string
	HostKey(context.Context, SSHTarget) (string, error)
	Install(context.Context, SSHInstall) (string, error)
	Job(context.Context, string) (ProvisionJob, error)
	// Subscribe follows a job: "provision.line" events carry {line, n}, where n
	// is the line's position, and "provision.status" ends it.
	Subscribe(context.Context, string) (events.Subscription, error)
}

// Provisioner installs agents over SSH. Jobs live in memory: a restart ends
// them, and the invitation can be used again until it expires.
type Provisioner struct {
	Core    *Core
	Origin  string
	Release Release
	// Dial overrides the network dial in tests.
	Dial func(ctx context.Context, network, addr string) (net.Conn, error)

	mu   sync.Mutex
	jobs map[string]*provisionJob
}

type provisionJob struct {
	mu sync.Mutex
	ProvisionJob
}

const (
	provisionTimeout  = 20 * time.Minute
	provisionMaxLines = 2000
	provisionMaxLine  = 4096
	provisionMaxJobs  = 50
)

func (p *Provisioner) Script(token string) string { return InstallScript(p.Origin, token, p.Release) }

func (p *Provisioner) dial(ctx context.Context, t SSHTarget) (net.Conn, error) {
	if p.Dial != nil {
		return p.Dial(ctx, "tcp", t.addr())
	}
	return (&net.Dialer{Timeout: 15 * time.Second}).DialContext(ctx, "tcp", t.addr())
}

// errHostKeySeen stops the scan handshake once the host key is known.
var errHostKeySeen = errors.New("host key recorded")

// HostKey connects far enough to read the server's host key and returns its
// SHA256 fingerprint for the person to confirm before installing.
func (p *Provisioner) HostKey(ctx context.Context, t SSHTarget) (string, error) {
	if _, e := authorize(ctx, "servers:write", true); e != nil {
		return "", e
	}
	if e := t.validate(); e != nil {
		return "", e
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	conn, e := p.dial(ctx, t)
	if e != nil {
		return "", fail(Unavailable, "The server couldn't be reached on that port")
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(20 * time.Second))
	var fingerprint string
	cfg := &ssh.ClientConfig{User: "probe", Auth: []ssh.AuthMethod{}, HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
		fingerprint = ssh.FingerprintSHA256(key)
		return errHostKeySeen
	}}
	// The handshake always fails here: the callback stops it once the key is known.
	_, _, _, _ = ssh.NewClientConn(conn, t.addr(), cfg)
	if fingerprint == "" {
		return "", fail(Unavailable, "The server didn't answer as SSH")
	}
	return fingerprint, nil
}

// Install checks the invitation and the confirmed host key, then runs the
// install script in the background. It returns the job to follow.
func (p *Provisioner) Install(ctx context.Context, in SSHInstall) (string, error) {
	if e := interactiveAdmin(ctx); e != nil {
		return "", e
	}
	if e := in.validate(); e != nil {
		return "", e
	}
	if e := p.checkInvitation(ctx, in.ServerID, in.Token); e != nil {
		return "", e
	}
	signer, e := parseKey(in.PrivateKey, in.Passphrase)
	if e != nil {
		return "", e
	}
	job := &provisionJob{ProvisionJob: ProvisionJob{ID: security.Token(), ServerID: in.ServerID, Status: "running", Lines: []string{}}}
	if e := p.register(job); e != nil {
		return "", e
	}
	if e := p.Core.mutate(ctx, func(tx *sql.Tx) error { return p.Core.audit(ctx, tx, "server.provision.ssh", in.ServerID) }); e != nil {
		return "", e
	}
	// The job outlives the request; it has its own deadline.
	run, cancel := context.WithTimeout(context.WithoutCancel(ctx), provisionTimeout)
	go func() {
		defer cancel()
		p.run(run, job, in, signer)
	}()
	return job.ID, nil
}

func (in SSHInstall) validate() error {
	if e := in.SSHTarget.validate(); e != nil {
		return e
	}
	if !sshUserPattern.MatchString(in.User) {
		return fail(Validation, "Enter a valid user name")
	}
	if !strings.HasPrefix(in.Fingerprint, "SHA256:") || len(in.Fingerprint) > 100 {
		return fail(Validation, "Check the server first to confirm its host key")
	}
	if !tokenPattern.MatchString(in.Token) {
		return fail(Validation, "Invalid invitation")
	}
	if len(in.PrivateKey) > 16<<10 || len(in.Passphrase) > 1024 {
		return fail(Validation, "The private key is too large")
	}
	return nil
}

func parseKey(key, passphrase string) (ssh.Signer, error) {
	var s ssh.Signer
	var e error
	if passphrase != "" {
		s, e = ssh.ParsePrivateKeyWithPassphrase([]byte(key), []byte(passphrase))
	} else {
		s, e = ssh.ParsePrivateKey([]byte(key))
	}
	var missing *ssh.PassphraseMissingError
	switch {
	case errors.As(e, &missing):
		return nil, fail(Validation, "This key needs its passphrase")
	case e != nil:
		return nil, fail(Validation, "The private key couldn't be read")
	}
	return s, nil
}

// checkInvitation confirms the token is the pending invitation for server, so
// only the script for that server can run.
func (p *Provisioner) checkInvitation(ctx context.Context, server, token string) error {
	var n int
	e := p.Core.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM invitations WHERE token_hash=? AND server_id=? AND expires_at>?", security.Hash(token), server, time.Now().Unix()).Scan(&n)
	if e != nil {
		return e
	}
	if n != 1 {
		return fail(Validation, "The invitation expired. Add the server again.")
	}
	return nil
}

func (p *Provisioner) register(j *provisionJob) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.jobs == nil {
		p.jobs = map[string]*provisionJob{}
	}
	if len(p.jobs) >= provisionMaxJobs {
		for id, old := range p.jobs {
			old.mu.Lock()
			finished := old.Status != "running"
			old.mu.Unlock()
			if finished {
				delete(p.jobs, id)
			}
		}
	}
	if len(p.jobs) >= provisionMaxJobs {
		return fail(Conflict, "Too many installations are running")
	}
	p.jobs[j.ID] = j
	return nil
}

// Job returns a copy of an installation's state.
func (p *Provisioner) Job(ctx context.Context, id string) (ProvisionJob, error) {
	if _, e := authorize(ctx, "servers:write", true); e != nil {
		return ProvisionJob{}, e
	}
	p.mu.Lock()
	j, ok := p.jobs[id]
	p.mu.Unlock()
	if !ok {
		return ProvisionJob{}, fail(NotFound, "Installation not found")
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	out := j.ProvisionJob
	out.Lines = append([]string(nil), j.Lines...)
	return out, nil
}

func (p *Provisioner) line(j *provisionJob, token, text string) {
	text = strings.ReplaceAll(text, token, "••••••")
	if len(text) > provisionMaxLine {
		text = text[:provisionMaxLine] + "…"
	}
	j.mu.Lock()
	if len(j.Lines) >= provisionMaxLines {
		j.mu.Unlock()
		return
	}
	j.Lines = append(j.Lines, text)
	n := len(j.Lines)
	j.mu.Unlock()
	p.Core.publish("provision/"+j.ID, "provision.line", map[string]any{"line": text, "n": n})
}

// Subscribe follows an installation administrators may see.
func (p *Provisioner) Subscribe(ctx context.Context, id string) (events.Subscription, error) {
	if _, e := p.Job(ctx, id); e != nil {
		return events.Subscription{}, e
	}
	return p.Core.Hub.Subscribe(ctx, "provision/"+id, 256), nil
}

func (p *Provisioner) finish(j *provisionJob, err error) {
	j.mu.Lock()
	j.Status = "done"
	if err != nil {
		j.Status, j.Error = "failed", err.Error()
	}
	status := j.ProvisionJob
	status.Lines = nil
	j.mu.Unlock()
	p.Core.publish("provision/"+j.ID, "provision.status", status)
}

func (p *Provisioner) run(ctx context.Context, j *provisionJob, in SSHInstall, signer ssh.Signer) {
	err := p.execute(ctx, j, in, signer)
	p.finish(j, err)
}

// execute connects with the confirmed host key only and runs the script via
// stdin as root, or through sudo for other users.
func (p *Provisioner) execute(ctx context.Context, j *provisionJob, in SSHInstall, signer ssh.Signer) error {
	conn, e := p.dial(ctx, in.SSHTarget)
	if e != nil {
		return errors.New("the server couldn't be reached")
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	cfg := &ssh.ClientConfig{User: in.User, Auth: []ssh.AuthMethod{ssh.PublicKeys(signer)}, Timeout: 15 * time.Second, HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
		if ssh.FingerprintSHA256(key) != in.Fingerprint {
			return errors.New("host key changed")
		}
		return nil
	}}
	c, chans, reqs, e := ssh.NewClientConn(conn, in.addr(), cfg)
	if e != nil {
		_ = conn.Close()
		if strings.Contains(e.Error(), "host key changed") {
			return errors.New("the server's host key doesn't match the one you confirmed")
		}
		return errors.New("the server refused the key")
	}
	client := ssh.NewClient(c, chans, reqs)
	defer client.Close()
	session, e := client.NewSession()
	if e != nil {
		return errors.New("the server refused to run commands")
	}
	defer session.Close()
	// Both streams go to the log, in the order the script writes them.
	out, w := io.Pipe()
	session.Stdout, session.Stderr = w, w
	session.Stdin = strings.NewReader(p.Script(in.Token) + "\n")
	command := "bash -s"
	if in.User != "root" {
		command = "sudo -n bash -s"
	}
	p.line(j, in.Token, "$ "+command)
	if e := session.Start(command); e != nil {
		return errors.New("the install script couldn't start")
	}
	done := make(chan error, 1)
	go func() {
		e := session.Wait()
		_ = w.Close()
		done <- e
	}()
	scan := bufio.NewScanner(out)
	scan.Buffer(make([]byte, 64<<10), 1<<20)
	for scan.Scan() {
		p.line(j, in.Token, scan.Text())
	}
	_ = out.Close()
	select {
	case <-ctx.Done():
		return errors.New("the installation took too long")
	case e := <-done:
		var exit *ssh.ExitError
		if errors.As(e, &exit) {
			if in.User != "root" && exit.ExitStatus() == 1 && j.lastLineContains("sudo") {
				return errors.New("sudo needs a password; use root or allow passwordless sudo")
			}
			return errors.New("the install script failed (exit " + strconv.Itoa(exit.ExitStatus()) + ")")
		}
		if e != nil {
			return errors.New("the connection ended before the script finished")
		}
		return nil
	}
}

func (j *provisionJob) lastLineContains(s string) bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	return len(j.Lines) > 0 && strings.Contains(j.Lines[len(j.Lines)-1], s)
}
