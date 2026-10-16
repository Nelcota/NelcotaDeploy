package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nelcota/nelcota-deploy/internal/events"
	agentv1 "github.com/nelcota/nelcota-deploy/internal/gen/agent/v1"
	"github.com/nelcota/nelcota-deploy/internal/transport"
)

func TestDeletedAppLogsAreDurablyRetriedAndCannotBeResurrected(t *testing.T) {
	c, ctx, app := fixture(t)
	logDir := t.TempDir()
	var err error
	c.LogStore, err = events.NewLogStore(logDir)
	if err != nil {
		t.Fatal(err)
	}
	d, err := (&deploysService{c}).Enqueue(ctx, DeployInput{AppID: app.ID, SHA: strings.Repeat("a", 40)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = c.DB.Write.ExecContext(ctx, "UPDATE deployments SET status='success' WHERE id=?", d.ID); err != nil {
		t.Fatal(err)
	}
	if err = (&appsService{c}).Action(ctx, app.ID, "stop", 0, true); err != nil {
		t.Fatal(err)
	}
	if err = (&appsService{c}).Delete(ctx, app.ID, true); err != nil {
		t.Fatal(err)
	}
	// Simulate a persistent filesystem failure without altering real data.
	blocked := filepath.Join(logDir, d.ID+".zst")
	if err = os.Mkdir(blocked, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(blocked, "blocked"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	worker := &Core{DB: c.DB, LogStore: c.LogStore}
	if err = worker.cleanupLogs(ctx); err == nil {
		t.Fatal("filesystem error ignored")
	}
	var pending int
	if err = c.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM log_cleanup").Scan(&pending); err != nil || pending != 1 {
		t.Fatal("cleanup job lost", pending, err)
	}
	if err = os.RemoveAll(blocked); err != nil {
		t.Fatal(err)
	}
	if err = c.LogStore.Append(ctx, d.ID, []byte("private build log\n")); err != nil {
		t.Fatal(err)
	}
	if err = worker.cleanupLogs(ctx); err != nil {
		t.Fatal(err)
	}
	if err = c.DB.Read.QueryRowContext(ctx, "SELECT count(*) FROM log_cleanup").Scan(&pending); err != nil || pending != 0 {
		t.Fatal(pending, err)
	}
	event := &agentv1.Event{Payload: &agentv1.Event_DeployLog{DeployLog: &agentv1.DeployLog{AppId: app.ID, DeployId: d.ID, Line: []byte("late log\n")}}}
	if err = c.AgentEvent(ctx, transport.Peer{ID: app.ServerID}, event); err == nil {
		t.Fatal("late log for deleted app accepted")
	}
	data, err := c.LogStore.Read(ctx, d.ID, 1024)
	if err != nil || len(data) != 0 {
		t.Fatal("deleted log resurrected", err)
	}
}
