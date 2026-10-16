package web

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/Nelcota/NelcotaDeploy/web/pages"
	"github.com/go-chi/chi/v5"
)

func (h *handler) inviteView(name string, inv service.Invitation) pages.InviteView {
	v := pages.InviteView{Name: name, Server: inv.ServerID, Token: inv.Token, Expires: inv.ExpiresAt, SSH: h.s.Provisioning != nil}
	if h.s.Provisioning != nil {
		v.Script = h.s.Provisioning.Script(inv.Token)
	} else {
		v.Script = service.InstallScript(h.cfg.Origin, inv.Token, service.Release{})
	}
	v.Placeholders = strings.Contains(v.Script, "MINISIGN_PUBLIC_KEY")
	return v
}

func sshTarget(r *http.Request) (service.SSHTarget, error) {
	if err := r.ParseForm(); err != nil {
		return service.SSHTarget{}, invalid("Invalid form")
	}
	port, err := strconv.Atoi(strings.TrimSpace(r.PostForm.Get("port")))
	if err != nil {
		return service.SSHTarget{}, invalid("Enter a port between 1 and 65535")
	}
	return service.SSHTarget{Host: strings.TrimSpace(r.PostForm.Get("host")), Port: port}, nil
}

func (h *handler) provisioning() (service.Provisioning, error) {
	if h.s.Provisioning == nil {
		return nil, &service.Error{Kind: service.Unavailable, Message: "Installing over SSH is unavailable"}
	}
	return h.s.Provisioning, nil
}

// checkSSHHost reads the server's host key for the person to confirm.
func (h *handler) checkSSHHost(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		p, err := h.provisioning()
		if err != nil {
			return err
		}
		target, err := sshTarget(r)
		if err != nil {
			return err
		}
		fingerprint, err := p.HostKey(r.Context(), target)
		if err != nil {
			return err
		}
		return s.patch(pages.SSHConfirm(chi.URLParam(r, "id"), fingerprint), "", "")
	})
}

// installOverSSH starts the installation and follows its log.
func (h *handler) installOverSSH(w http.ResponseWriter, r *http.Request) {
	h.act(w, r, func(s *stream) error {
		p, err := h.provisioning()
		if err != nil {
			return err
		}
		target, err := sshTarget(r)
		if err != nil {
			return err
		}
		f := r.PostForm
		id, err := p.Install(r.Context(), service.SSHInstall{SSHTarget: target, ServerID: chi.URLParam(r, "id"), Token: f.Get("token"), User: strings.TrimSpace(f.Get("user")), PrivateKey: f.Get("private_key"), Passphrase: f.Get("passphrase"), Fingerprint: f.Get("fingerprint")})
		if err != nil {
			return err
		}
		// The key is no longer needed in the page.
		if err := s.run("document.getElementById('ssh-key').value='';document.getElementById('ssh-passphrase').value=''"); err != nil {
			return err
		}
		return s.patch(pages.SSHProgress(id), "", "")
	})
}

// provisionStream sends the log so far, then new lines until the job ends.
// It subscribes before reading the log and skips lines already sent, so no
// line is lost or repeated.
func (h *handler) provisionStream(w http.ResponseWriter, r *http.Request) {
	p, err := h.provisioning()
	if err != nil {
		h.act(w, r, func(*stream) error { return err })
		return
	}
	id := chi.URLParam(r, "id")
	sub, err := p.Subscribe(r.Context(), id)
	if err != nil {
		h.act(w, r, func(*stream) error { return err })
		return
	}
	defer sub.Cancel()
	job, err := p.Job(r.Context(), id)
	if err != nil {
		h.act(w, r, func(*stream) error { return err })
		return
	}
	s := newStream(w, r)
	if s.patch(pages.SSHLog(job.Lines), "", "") != nil {
		return
	}
	if job.Status != "running" {
		_ = s.patch(pages.SSHStatus(job), "", "")
		return
	}
	sent := len(job.Lines)
	keepalive := time.NewTicker(liveInterval)
	defer keepalive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-keepalive.C:
			if s.comment() != nil {
				return
			}
		case ev, ok := <-sub.C:
			if !ok {
				return
			}
			switch ev.Kind {
			case "provision.line":
				var v struct {
					Line string `json:"line"`
					N    int    `json:"n"`
				}
				if json.Unmarshal(ev.Data, &v) != nil || v.N <= sent {
					continue
				}
				sent = v.N
				if s.patch(pages.SSHLine(v.Line), "#ssh-log", modeAppend) != nil {
					return
				}
			case "provision.status":
				var j service.ProvisionJob
				if json.Unmarshal(ev.Data, &j) == nil {
					_ = s.patch(pages.SSHStatus(j), "", "")
				}
				return
			}
		}
	}
}
