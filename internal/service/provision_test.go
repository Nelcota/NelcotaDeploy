package service

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"encoding/pem"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/security"
	"golang.org/x/crypto/ssh"
)

func TestInstallScriptOnlyEmbedsSafeValues(t *testing.T) {
	token := strings.Repeat("A", 43)
	release := ReleaseFor("https://releases.example.com/nelcota/", "v1.4.2", "RWQ"+strings.Repeat("a", 40))
	s := InstallScript("https://panel.example.com", token, release)
	if !strings.Contains(s, "--release-url https://releases.example.com/nelcota/v1.4.2 --signing-key 'RWQ") || !strings.Contains(s, "'"+token+"'") {
		t.Fatal(s)
	}
	for _, r := range []Release{ReleaseFor("https://r.example.com", "v0.0.0-dev", "RWQ"+strings.Repeat("a", 40)), ReleaseFor("https://r.example.com", "v1.0.0", "key'; rm -rf /; '")} {
		if s := InstallScript("https://panel.example.com", token, r); !strings.Contains(s, "RELEASE_URL/vX.Y.Z") || !strings.Contains(s, "MINISIGN_PUBLIC_KEY") {
			t.Fatal("unsafe or development release embedded:", s)
		}
	}
	if s := InstallScript("https://panel.example.com", "x'; reboot; '", release); strings.Contains(s, "reboot") {
		t.Fatal("token broke out of its quotes")
	}
}

// sshServer accepts one client key and records the script each session runs.
type sshServer struct {
	addr    string
	hostKey ssh.PublicKey
	mu      sync.Mutex
	scripts []string
	command string
	exit    uint32
}

func newSSHServer(t *testing.T, client ssh.PublicKey) *sshServer {
	t.Helper()
	_, hostPriv, _ := ed25519.GenerateKey(rand.Reader)
	hostSigner, _ := ssh.NewSignerFromKey(hostPriv)
	cfg := &ssh.ServerConfig{PublicKeyCallback: func(_ ssh.ConnMetadata, k ssh.PublicKey) (*ssh.Permissions, error) {
		if string(k.Marshal()) != string(client.Marshal()) {
			return nil, io.EOF
		}
		return nil, nil
	}}
	cfg.AddHostKey(hostSigner)
	l, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = l.Close() })
	s := &sshServer{addr: l.Addr().String(), hostKey: hostSigner.PublicKey()}
	go func() {
		for {
			conn, e := l.Accept()
			if e != nil {
				return
			}
			go s.serve(conn, cfg)
		}
	}()
	return s
}

func (s *sshServer) serve(conn net.Conn, cfg *ssh.ServerConfig) {
	_, chans, reqs, e := ssh.NewServerConn(conn, cfg)
	if e != nil {
		return
	}
	go ssh.DiscardRequests(reqs)
	for nc := range chans {
		ch, requests, e := nc.Accept()
		if e != nil {
			return
		}
		go func() {
			defer ch.Close()
			for r := range requests {
				if r.Type != "exec" {
					_ = r.Reply(false, nil)
					continue
				}
				_ = r.Reply(true, nil)
				n := binary.BigEndian.Uint32(r.Payload[:4])
				s.mu.Lock()
				s.command = string(r.Payload[4 : 4+n])
				s.mu.Unlock()
				script, _ := io.ReadAll(ch)
				s.mu.Lock()
				s.scripts = append(s.scripts, string(script))
				exit := s.exit
				s.mu.Unlock()
				_, _ = io.WriteString(ch, "installing agent\n")
				// Echo the join line, as a verbose installer might.
				for line := range strings.Lines(string(script)) {
					if strings.Contains(line, "printf") {
						_, _ = io.WriteString(ch.Stderr(), line)
					}
				}
				status := make([]byte, 4)
				binary.BigEndian.PutUint32(status, exit)
				_, _ = ch.SendRequest("exit-status", false, status)
				return
			}
		}()
	}
}

func clientKey(t *testing.T) (string, ssh.PublicKey) {
	t.Helper()
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	block, e := ssh.MarshalPrivateKey(priv, "")
	if e != nil {
		t.Fatal(e)
	}
	signer, _ := ssh.NewSignerFromKey(priv)
	return string(pem.EncodeToMemory(block)), signer.PublicKey()
}

func waitJob(t *testing.T, p *Provisioner, ctxJob func() (ProvisionJob, error)) ProvisionJob {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		j, e := ctxJob()
		if e != nil {
			t.Fatal(e)
		}
		if j.Status != "running" {
			return j
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("installation did not finish")
	return ProvisionJob{}
}

func TestInstallOverSSH(t *testing.T) {
	c, ctx, a := fixture(t)
	p, _ := CurrentUser(ctx)
	p.TwoFactorAt = time.Now().Unix()
	ctx = WithPrincipal(ctx, p)
	key, pub := clientKey(t)
	srv := newSSHServer(t, pub)
	host, portText, _ := net.SplitHostPort(srv.addr)
	port, _ := strconv.Atoi(portText)
	token := security.Token()
	if _, e := c.DB.Write.ExecContext(ctx, "INSERT INTO invitations(token_hash,server_id,expires_at) VALUES(?,?,?)", security.Hash(token), a.ServerID, time.Now().Add(time.Hour).Unix()); e != nil {
		t.Fatal(e)
	}
	prov := &Provisioner{Core: c, Origin: "https://panel.example.com", Release: ReleaseFor("https://releases.example.com", "v1.4.2", "RWQ"+strings.Repeat("a", 40))}
	target := SSHTarget{Host: host, Port: port}

	fingerprint, e := prov.HostKey(ctx, target)
	if e != nil || fingerprint != ssh.FingerprintSHA256(srv.hostKey) {
		t.Fatal(fingerprint, e)
	}
	in := SSHInstall{SSHTarget: target, ServerID: a.ServerID, Token: token, User: "root", PrivateKey: key, Fingerprint: fingerprint}
	id, e := prov.Install(ctx, in)
	if e != nil {
		t.Fatal(e)
	}
	job := waitJob(t, prov, func() (ProvisionJob, error) { return prov.Job(ctx, id) })
	if job.Status != "done" || job.Error != "" {
		t.Fatalf("%+v", job)
	}
	srv.mu.Lock()
	script, command := srv.scripts[0], srv.command
	srv.mu.Unlock()
	if command != "bash -s" || strings.TrimSpace(script) != strings.TrimSpace(prov.Script(token)) || !strings.Contains(script, "--release-url https://releases.example.com/v1.4.2") {
		t.Fatal(command, script)
	}
	log := strings.Join(job.Lines, "\n")
	if strings.Contains(log, token) || !strings.Contains(log, "installing agent") || !strings.Contains(log, "••••••") {
		t.Fatal("token shown in the log or output missing:", log)
	}

	// A different host key than the one confirmed is refused before login.
	in.Fingerprint = "SHA256:" + strings.Repeat("x", 43)
	id, _ = prov.Install(ctx, in)
	job = waitJob(t, prov, func() (ProvisionJob, error) { return prov.Job(ctx, id) })
	if job.Status != "failed" || !strings.Contains(job.Error, "host key") {
		t.Fatalf("%+v", job)
	}
	srv.mu.Lock()
	runs := len(srv.scripts)
	srv.mu.Unlock()
	if runs != 1 {
		t.Fatal("ran the script on an unconfirmed host")
	}

	// Other users go through sudo; a failing script is reported.
	in.Fingerprint, in.User = fingerprint, "deploy"
	srv.mu.Lock()
	srv.exit = 3
	srv.mu.Unlock()
	id, _ = prov.Install(ctx, in)
	job = waitJob(t, prov, func() (ProvisionJob, error) { return prov.Job(ctx, id) })
	srv.mu.Lock()
	command = srv.command
	srv.mu.Unlock()
	if command != "sudo -n bash -s" || job.Status != "failed" || !strings.Contains(job.Error, "exit 3") {
		t.Fatalf("%s %+v", command, job)
	}

	// The token must be this server's pending invitation.
	in.Token = security.Token()
	if _, e := prov.Install(ctx, in); !Is(e, Validation) {
		t.Fatal("accepted an unknown invitation", e)
	}
	// Installing with root credentials needs a recent passkey sign-in.
	p.TwoFactorAt = 0
	if _, e := prov.Install(WithPrincipal(ctx, p), SSHInstall{}); !Is(e, Forbidden) {
		t.Fatal(e)
	}
	if _, e := prov.HostKey(ctx, SSHTarget{Host: "-oProxyCommand=x", Port: 22}); !Is(e, Validation) {
		t.Fatal("accepted an option as a host", e)
	}
}
