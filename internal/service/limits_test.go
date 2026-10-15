package service

import (
	"bytes"
	agentv1 "github.com/nelcota/nelcota-deploy/internal/gen/agent/v1"
	"github.com/nelcota/nelcota-deploy/internal/transport"
	"strings"
	"testing"
)

func TestServerLimitsInSnapshotAndContainerMetricOwnership(t *testing.T) {
	c, ctx, app := fixture(t)
	server, e := (&serversService{c}).UpdateLimits(ctx, app.ServerID, ServerLimitsInput{BuildLimit: 2, CacheBytes: 1 << 30})
	if e != nil || server.BuildLimit != 2 {
		t.Fatal(e)
	}
	if _, e = (&serversService{c}).UpdateLimits(ctx, app.ServerID, ServerLimitsInput{BuildLimit: 100, CacheBytes: 1 << 30}); !Is(e, Validation) {
		t.Fatal(e)
	}
	d := &operationDispatcher{}
	c.Control = d
	if e = c.sendSnapshot(ctx, app.ServerID); e != nil {
		t.Fatal(e)
	}
	if d.commands[0].Desired.Limits.BuildLimit != 2 || d.commands[0].Desired.Limits.CacheBytes != 1<<30 {
		t.Fatal(d.commands[0])
	}
	metric := &agentv1.Metrics{Containers: []*agentv1.ContainerMetrics{{AppId: app.ID, ContainerId: "container", MemoryUsed: 100}}}
	if e = c.AgentEvent(ctx, transport.Peer{ID: "another-server"}, &agentv1.Event{Payload: &agentv1.Event_Metrics{Metrics: metric}}); !Is(e, Forbidden) {
		t.Fatal("metrics crossed server boundary", e)
	}
	if e = c.AgentEvent(ctx, transport.Peer{ID: app.ServerID}, &agentv1.Event{Payload: &agentv1.Event_Metrics{Metrics: metric}}); e != nil {
		t.Fatal(e)
	}
}

func TestS3SettingsAreValidatedEncryptedAndNeverReadBack(t *testing.T) {
	c, ctx, _ := fixture(t)
	s := &settingsService{c}
	secret := `{"endpoint":"https://s3.example.test","region":"auto","bucket":"backups","access_key":"access","secret_key":"private-s3-credential"}`
	if e := s.Set(ctx, "backup.s3", strings.Replace(secret, "https://", "http://", 1)); !Is(e, Validation) {
		t.Fatal("accepted plaintext S3 endpoint", e)
	}
	if e := s.Set(ctx, "backup.s3", secret); e != nil {
		t.Fatal(e)
	}
	var encrypted []byte
	if e := c.DB.Read.QueryRowContext(ctx, "SELECT encrypted FROM settings WHERE key='backup.s3'").Scan(&encrypted); e != nil {
		t.Fatal(e)
	}
	if bytes.Contains(encrypted, []byte("private-s3-credential")) {
		t.Fatal("S3 secret stored as plaintext")
	}
	view, e := s.Get(ctx)
	if e != nil || len(view.Configured) != 1 || view.Configured[0] != "backup.s3" {
		t.Fatal(view, e)
	}
}
