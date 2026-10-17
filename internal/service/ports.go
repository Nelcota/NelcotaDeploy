package service

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"

	"github.com/Nelcota/NelcotaDeploy/internal/security"
)

// listenLine recognizes a line where an app says which port it serves on, such
// as "listening on 0.0.0.0:3000", "Server running at http://localhost:5000/",
// or "Listening on port 4000".
var (
	listenLine = regexp.MustCompile(`(?i)\b(listen(?:s|ing)?|running|serving|started|server|ready)\b`)
	listenPort = regexp.MustCompile(`(?i)(?:(?:\d{1,3}\.){3}\d{1,3}|localhost|\[[0-9a-f:]*\]|\*|::|[a-z][\w.-]*):(\d{2,5})(?:[^:\d]|$)|\bport\s*[:=]?\s*(\d{2,5})\b`)
)

// portFromLog returns the last port the app reported listening on in a
// deployment log, or 0. Lines written by the panel's own pipeline stages, such
// as the health check's "no response on port 8080", are ignored.
func portFromLog(log []byte) uint32 {
	var port uint32
	sc := bufio.NewScanner(bytes.NewReader(log))
	sc.Buffer(make([]byte, 0, 64<<10), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		for _, own := range []string{"[clone]", "[build]", "[healthcheck]", "[route]"} {
			if strings.HasPrefix(line, own) {
				line = ""
			}
		}
		if line == "" || !listenLine.MatchString(line) {
			continue
		}
		for _, m := range listenPort.FindAllStringSubmatch(line, -1) {
			v := m[1] + m[2]
			if n, e := strconv.ParseUint(v, 10, 16); e == nil && n > 0 {
				port = uint32(n)
			}
		}
	}
	return port
}

// SuggestedPort reads a deployment that failed because the app never answered
// its health check and returns the port the app said it listens on, when that
// differs from the app's configured port. It returns 0 when there is nothing
// to suggest.
func (s *deploysService) SuggestedPort(ctx context.Context, id string) (uint32, error) {
	if _, e := authorize(ctx, "deploys:read", false); e != nil {
		return 0, e
	}
	d, e := s.Get(ctx, id)
	if e != nil {
		return 0, e
	}
	if d.Status != "failed" || d.ErrorCode != "health_no_response" {
		return 0, nil
	}
	a, e := (&appsService{s.c}).Get(ctx, d.AppID)
	if e != nil {
		return 0, e
	}
	log, e := (&logsService{s.c}).Read(ctx, id)
	if e != nil {
		if Is(e, Forbidden) {
			return 0, nil
		}
		return 0, e
	}
	if p := portFromLog(log); p != a.Config.Port {
		return p, nil
	}
	return 0, nil
}

// PublishOnPort changes a failed deployment's app to listen on port and
// publishes the same commit again, in one transaction. It needs the rights to
// change the app's settings and to publish, and both changes are audited.
func (s *deploysService) PublishOnPort(ctx context.Context, id string, port uint32) (Deployment, error) {
	p, e := authorize(ctx, "apps:write", true)
	if e != nil {
		return Deployment{}, e
	}
	if _, e := authorize(ctx, "deploys:write", false); e != nil {
		return Deployment{}, e
	}
	d, e := s.Get(ctx, id)
	if e != nil {
		return Deployment{}, e
	}
	if d.Status != "failed" {
		return Deployment{}, fail(Conflict, "Only a failed deployment can be published again on another port")
	}
	a, e := (&appsService{s.c}).Get(ctx, d.AppID)
	if e != nil {
		return Deployment{}, e
	}
	if port < 1 || port > 65535 {
		return Deployment{}, fail(Validation, "Enter a port between 1 and 65535")
	}
	in := AppInput{Name: a.Name, ServerID: a.ServerID, Repository: a.Repository, Branch: a.Branch, Config: a.Config}
	in.Config.Port = port
	if e := validateApp(&in); e != nil {
		return Deployment{}, e
	}
	cfg, _ := json.Marshal(in.Config)
	next := DeployInput{AppID: a.ID, SHA: d.SHA, Message: d.Message, Author: p.Name, Origin: "manual"}
	if next.Message == "" {
		next.Message = "Manual deployment"
	}
	newID := security.Token()
	e = s.c.mutate(ctx, func(tx *sql.Tx) error {
		r, e := tx.ExecContext(ctx, "UPDATE apps SET config=?,revision=revision+1 WHERE id=? AND revision=?", string(cfg), a.ID, a.Revision)
		if e != nil {
			return dbError(e)
		}
		if n, _ := r.RowsAffected(); n == 0 {
			return fail(Conflict, "The app changed meanwhile. Reload and try again.")
		}
		if e := s.c.audit(ctx, tx, "app.port", a.ID); e != nil {
			return e
		}
		return s.enqueue(ctx, tx, newID, next)
	})
	if e != nil {
		return Deployment{}, e
	}
	if updated, e := (&appsService{s.c}).Get(ctx, a.ID); e == nil {
		s.c.publish("apps", "app.updated", updated)
	}
	out, e := s.Get(ctx, newID)
	s.c.publish("deployments", "deploy.queued", out)
	return out, e
}
